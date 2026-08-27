const intEnv = (name, fallback, min, max) => {
    const value = Number.parseInt(process.env[name] || "", 10);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
};

export const AI_OPERATION_LIMITS = Object.freeze({
    generationTimeoutMs: intEnv("AI_GENERATION_TIMEOUT_MS", 10 * 60 * 1000, 30_000, 30 * 60 * 1000),
    revisionTimeoutMs: intEnv("AI_REVISION_TIMEOUT_MS", 3 * 60 * 1000, 15_000, 15 * 60 * 1000),
    maxProviderCalls: intEnv("AI_MAX_PROVIDER_CALLS", 180, 1, 500),
});

export function createOperationBudget({ timeoutMs, maxCalls = AI_OPERATION_LIMITS.maxProviderCalls, label = "AI operation" } = {}) {
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    let calls = 0;
    const assertActive = () => {
        if (Date.now() > deadline) {
            throw Object.assign(new Error(`${label} exceeded its time budget`), { status: 504, code: "AI_OPERATION_TIMEOUT" });
        }
    };
    return {
        assertActive,
        consumeCall() {
            assertActive();
            calls += 1;
            if (calls > maxCalls) {
                throw Object.assign(new Error(`${label} exceeded its provider-call budget`), { status: 429, code: "AI_OPERATION_CALL_BUDGET_EXCEEDED" });
            }
            return calls;
        },
        snapshot() { return { startedAt, deadline, calls, maxCalls, timeoutMs }; },
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
