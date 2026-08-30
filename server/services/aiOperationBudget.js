import crypto from "crypto";
import { getRequestContext } from "./requestContext.js";
import { reserveTokens, consumeReservedTokens, releaseReservedTokens, TOKEN_QUOTA } from "./tokenQuota.js";

const intEnv = (name, fallback, min, max) => {
    const value = Number.parseInt(process.env[name] || "", 10);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
};

export const AI_OPERATION_LIMITS = Object.freeze({
    generationTimeoutMs: intEnv("AI_GENERATION_TIMEOUT_MS", 10 * 60 * 1000, 30_000, 30 * 60 * 1000),
    revisionTimeoutMs: intEnv("AI_REVISION_TIMEOUT_MS", 3 * 60 * 1000, 15_000, 15 * 60 * 1000),
    maxProviderCalls: intEnv("AI_MAX_PROVIDER_CALLS", 180, 1, 500),
    maxProviderOutputTokens: intEnv("AI_MAX_PROVIDER_OUTPUT_TOKENS", 65_536, 1_024, 131_072),
});

const asUsageNumber = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

export function createOperationBudget({ timeoutMs, maxCalls = AI_OPERATION_LIMITS.maxProviderCalls, label = "AI operation", userId = null, operationId = null } = {}) {
    const context = getRequestContext();
    const owner = userId || context.userId || null;
    const tokenOperationId = operationId || crypto.randomUUID();
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    let calls = 0;
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const assertActive = () => {
        if (Date.now() > deadline) throw Object.assign(new Error(`${label} exceeded its time budget`), { status: 504, code: "AI_OPERATION_TIMEOUT" });
    };
    return {
        assertActive,
        async beforeProviderCall() {
            assertActive();
            calls += 1;
            if (calls > maxCalls) throw Object.assign(new Error(`${label} exceeded its provider-call budget`), { status: 429, code: "AI_OPERATION_CALL_BUDGET_EXCEEDED" });
            if (owner) {
                const reservationId = crypto.randomUUID();
                await reserveTokens(owner, tokenOperationId, reservationId, TOKEN_QUOTA.reservationChunk);
                return reservationId;
            }
            return null;
        },
        async recordUsage(rawUsage, reservationId) {
            const inputTokens = asUsageNumber(rawUsage?.inputTokens ?? rawUsage?.promptTokens);
            const outputTokens = asUsageNumber(rawUsage?.outputTokens ?? rawUsage?.completionTokens);
            const reportedTotal = asUsageNumber(rawUsage?.totalTokens);
            const consumed = reportedTotal || inputTokens + outputTokens;
            usage.inputTokens += inputTokens;
            usage.outputTokens += outputTokens;
            usage.totalTokens += consumed;
            if (owner && reservationId) {
                await consumeReservedTokens(owner, tokenOperationId, reservationId, consumed);
                await releaseReservedTokens(owner, tokenOperationId, reservationId);
            }
        },
        async releaseReservation(reservationId) {
            if (owner && reservationId) await releaseReservedTokens(owner, tokenOperationId, reservationId);
        },
        snapshot() { return { startedAt, deadline, calls, maxCalls, timeoutMs, usage: { ...usage } }; },
    };
}

export function createBudgetedProviderCall(generate, budget) {
    if (typeof generate !== "function") throw new TypeError("generate must be a function");
    if (!budget?.beforeProviderCall) throw new TypeError("A valid operation budget is required");
    return async (options) => {
        let reservationId = null;
        try {
            reservationId = await budget.beforeProviderCall();
            const result = await generate({ ...options, maxRetries: 0, maxTokens: AI_OPERATION_LIMITS.maxProviderOutputTokens });
            await budget.recordUsage?.(result?.usage, reservationId);
            reservationId = null;
            return result;
        } catch (error) {
            await budget.releaseReservation?.(reservationId).catch(() => {});
            error.operationBudget = budget.snapshot?.();
            throw error;
        }
    };
}

export async function withOperationTimeout(task, { timeoutMs, label = "AI operation" } = {}) {
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(task),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(Object.assign(new Error(`${label} exceeded its time budget`), { status: 504, code: "AI_OPERATION_TIMEOUT" })), timeoutMs);
                timer.unref?.();
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}
