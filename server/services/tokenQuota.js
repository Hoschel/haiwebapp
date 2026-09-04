import { TokenAccount } from "../models/TokenAccount.js";

const intEnv = (name, fallback, min, max) => {
    const value = Number.parseInt(process.env[name] || "", 10);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
};

export const TOKEN_QUOTA = Object.freeze({
    dailyFreeTokens: intEnv("DAILY_FREE_TOKENS", 1_000_000, 1, 100_000_000),
    reservationChunk: intEnv("AI_TOKEN_RESERVATION_CHUNK", 200_000, 10_000, 1_000_000),
    resetWindowMs: intEnv("FREE_TOKEN_RESET_WINDOW_MS", 24 * 60 * 60 * 1000, 60_000, 7 * 24 * 60 * 60 * 1000),
});

const asTokens = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
};

async function ensureAccount(owner) {
    const now = new Date();
    let account = await TokenAccount.findOneAndUpdate(
        { owner },
        { $setOnInsert: { owner, dailyFreeLimit: TOKEN_QUOTA.dailyFreeTokens, freeRemaining: TOKEN_QUOTA.dailyFreeTokens, freeResetAt: new Date(now.getTime() + TOKEN_QUOTA.resetWindowMs) } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    // A cycle renewal restores the free allowance to exactly the daily limit.
    // Unused free tokens are not carried above 1M and paid tokens are untouched.
    if (account.freeResetAt <= now) {
        const resetAt = new Date(now.getTime() + TOKEN_QUOTA.resetWindowMs);
        account = await TokenAccount.findOneAndUpdate(
            { owner, freeResetAt: { $lte: now } },
            [
                { $set: {
                    freeRemaining: { $cond: [
                        { $gte: ["$freeRemaining", "$dailyFreeLimit"] },
                        "$dailyFreeLimit",
                        "$dailyFreeLimit",
                    ] },
                    freeResetAt: resetAt,
                } },
            ],
            { new: true },
        ) || account;
    }
    return account;
}

function quotaSnapshot(account) { return { dailyFreeLimit: account.dailyFreeLimit, freeRemaining: account.freeRemaining, paidBalance: account.paidBalance, reservedTokens: account.reservedTokens, available: Math.max(0, account.freeRemaining + account.paidBalance), freeResetAt: account.freeResetAt }; }
function quotaError(snapshot, message = "Daily token limit reached. Wait until the free token reset time or purchase additional tokens to continue.") { const error = new Error(message); error.status = 402; error.code = "AI_TOKEN_QUOTA_EXCEEDED"; error.quota = snapshot; return error; }
export async function getTokenQuota(owner) { return quotaSnapshot(await ensureAccount(owner)); }

export async function reserveTokens(owner, operationId, reservationId, amount = TOKEN_QUOTA.reservationChunk) {
    const requested = asTokens(amount); if (!requested || !operationId || !reservationId) throw new Error("Token reservation requires operationId, reservationId and a positive amount");
    const now = new Date(); await ensureAccount(owner);
    const availableExpression = { $add: ["$freeRemaining", "$paidBalance"] };
    const freeTake = { $min: [requested, "$freeRemaining"] };
    const paidTake = { $subtract: [requested, freeTake] };
    const nextFree = { $subtract: ["$freeRemaining", freeTake] };
    const account = await TokenAccount.findOneAndUpdate(
        { owner, "activeReservations.reservationId": { $ne: reservationId }, $expr: { $gte: [availableExpression, requested] } },
        [{ $set: {
            freeRemaining: nextFree,
            paidBalance: { $subtract: ["$paidBalance", paidTake] },
            reservedTokens: { $add: ["$reservedTokens", requested] },
            activeReservations: { $concatArrays: ["$activeReservations", [{ operationId, reservationId, reservedTokens: requested, freeReservedTokens: freeTake, paidReservedTokens: paidTake, freeCycleResetAt: "$freeResetAt", consumptionApplied: false, createdAt: now }]] },
        } }], { new: true },
    );
    if (!account) { const current = await ensureAccount(owner); const existing = current.activeReservations?.find((item) => item.reservationId === reservationId); if (existing) return quotaSnapshot(current); throw quotaError(quotaSnapshot(current)); }
    return quotaSnapshot(account);
}

export async function consumeReservedTokens(owner, operationId, reservationId, amount) {
    const requested = asTokens(amount); if (!requested) return getTokenQuota(owner);
    const account = await TokenAccount.findOneAndUpdate(
        { owner, activeReservations: { $elemMatch: { operationId, reservationId, reservedTokens: { $gte: requested }, consumptionApplied: false } } },
        [{ $set: {
            reservedTokens: { $subtract: ["$reservedTokens", requested] },
            activeReservations: { $map: { input: "$activeReservations", as: "reservation", in: { $cond: [
                { $eq: ["$$reservation.reservationId", reservationId] },
                { $let: { vars: { freeUsed: { $min: [requested, "$$reservation.freeReservedTokens"] } }, in: { $mergeObjects: ["$$reservation", { reservedTokens: { $subtract: ["$$reservation.reservedTokens", requested] }, freeReservedTokens: { $subtract: ["$$reservation.freeReservedTokens", "$$freeUsed"] }, paidReservedTokens: { $subtract: ["$$reservation.paidReservedTokens", { $subtract: [requested, "$$freeUsed"] }] }, consumptionApplied: true }] } } },
                "$$reservation",
            ] } } },
        } },
        { $set: { activeReservations: { $filter: { input: "$activeReservations", as: "reservation", cond: { $gt: ["$$reservation.reservedTokens", 0] } } } } }], { new: true },
    );
    if (account) return quotaSnapshot(account);
    const current = await ensureAccount(owner);
    const reservation = current.activeReservations?.find((item) => item.reservationId === reservationId && item.operationId === operationId);
    if (!reservation || reservation.consumptionApplied) return quotaSnapshot(current);
    throw quotaError(quotaSnapshot(current), "The provider usage exceeded the token reservation for this AI call.");
}

export async function releaseReservedTokens(owner, operationId, reservationId) {
    const account = await TokenAccount.findOneAndUpdate(
        { owner, activeReservations: { $elemMatch: { operationId, reservationId } } },
        [{ $set: {
            reservedTokens: { $subtract: ["$reservedTokens", { $let: { vars: { r: { $arrayElemAt: [{ $filter: { input: "$activeReservations", as: "item", cond: { $and: [{ $eq: ["$$item.operationId", operationId] }, { $eq: ["$$item.reservationId", reservationId] }] } } }, 0] } }, in: "$$r.reservedTokens" } }] },
            freeRemaining: { $min: ["$dailyFreeLimit", { $add: ["$freeRemaining", { $let: { vars: { r: { $arrayElemAt: [{ $filter: { input: "$activeReservations", as: "item", cond: { $and: [{ $eq: ["$$item.operationId", operationId] }, { $eq: ["$$item.reservationId", reservationId] }] } } }, 0] } }, in: { $cond: [{ $eq: ["$$r.freeCycleResetAt", "$freeResetAt"] }, "$$r.freeReservedTokens", 0] } } }] }] },
            paidBalance: { $add: ["$paidBalance", { $let: { vars: { r: { $arrayElemAt: [{ $filter: { input: "$activeReservations", as: "item", cond: { $and: [{ $eq: ["$$item.operationId", operationId] }, { $eq: ["$$item.reservationId", reservationId] }] } } }, 0] } }, in: "$$r.paidReservedTokens" } }] },
            activeReservations: { $filter: { input: "$activeReservations", as: "reservation", cond: { $not: { $and: [{ $eq: ["$$reservation.operationId", operationId] }, { $eq: ["$$reservation.reservationId", reservationId] }] } } } },
        } }], { new: true },
    );
    return account ? quotaSnapshot(account) : getTokenQuota(owner);
}

export function isQuotaError(error) { return error?.code === "AI_TOKEN_QUOTA_EXCEEDED" || error?.code === "AI_TOKEN_RESERVATION_EXCEEDED"; }
