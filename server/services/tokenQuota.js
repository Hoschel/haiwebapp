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
    if (account.freeResetAt <= now) {
        account = await TokenAccount.findOneAndUpdate(
            { owner, freeResetAt: { $lte: now } },
            { $set: { freeRemaining: account.dailyFreeLimit, freeResetAt: new Date(now.getTime() + TOKEN_QUOTA.resetWindowMs) } },
            { new: true },
        ) || account;
    }
    return account;
}

function quotaSnapshot(account) {
    return {
        dailyFreeLimit: account.dailyFreeLimit,
        freeRemaining: account.freeRemaining,
        paidBalance: account.paidBalance,
        reservedTokens: account.reservedTokens,
        available: Math.max(0, account.freeRemaining + account.paidBalance - account.reservedTokens),
        freeResetAt: account.freeResetAt,
    };
}

function quotaError(snapshot, message = "Daily token limit reached. Wait until the free token reset time or purchase additional tokens to continue.") {
    const error = new Error(message);
    error.status = 402;
    error.code = "AI_TOKEN_QUOTA_EXCEEDED";
    error.quota = snapshot;
    return error;
}

export async function getTokenQuota(owner) { return quotaSnapshot(await ensureAccount(owner)); }

export async function reserveTokens(owner, operationId, reservationId, amount = TOKEN_QUOTA.reservationChunk) {
    const requested = asTokens(amount);
    if (!requested || !operationId || !reservationId) throw new Error("Token reservation requires operationId, reservationId and a positive amount");
    await ensureAccount(owner);
    const availableExpression = { $subtract: [{ $add: ["$freeRemaining", "$paidBalance"] }, "$reservedTokens"] };
    const account = await TokenAccount.findOneAndUpdate(
        { owner, "activeReservations.reservationId": { $ne: reservationId }, $expr: { $gte: [availableExpression, requested] } },
        { $inc: { reservedTokens: requested }, $push: { activeReservations: { operationId, reservationId, reservedTokens: requested, createdAt: new Date() } } },
        { new: true },
    );
    if (!account) {
        const current = await ensureAccount(owner);
        const existing = current.activeReservations?.find((item) => item.reservationId === reservationId);
        if (existing) return quotaSnapshot(current);
        throw quotaError(quotaSnapshot(current));
    }
    return quotaSnapshot(account);
}

export async function consumeReservedTokens(owner, operationId, reservationId, amount) {
    const requested = asTokens(amount);
    if (!requested) return getTokenQuota(owner);
    const account = await TokenAccount.findOneAndUpdate(
        { owner, activeReservations: { $elemMatch: { operationId, reservationId, reservedTokens: { $gte: requested } } } },
        [
            { $set: {
                freeRemaining: { $subtract: ["$freeRemaining", { $min: [requested, "$freeRemaining"] }] },
                paidBalance: { $subtract: ["$paidBalance", { $max: [0, { $subtract: [requested, "$freeRemaining"] }] }] },
                reservedTokens: { $subtract: ["$reservedTokens", requested] },
                freeResetAt: {
                    $let: {
                        vars: { nextFree: { $subtract: ["$freeRemaining", { $min: [requested, "$freeRemaining"] }] } },
                        in: { $cond: [{ $and: [{ $gt: ["$freeRemaining", 0] }, { $eq: ["$$nextFree", 0] }] }, { $dateAdd: { startDate: "$$NOW", unit: "millisecond", amount: TOKEN_QUOTA.resetWindowMs } }, "$freeResetAt"] },
                    },
                },
                activeReservations: { $map: { input: "$activeReservations", as: "reservation", in: { $cond: [{ $eq: ["$$reservation.reservationId", reservationId] }, { $mergeObjects: ["$$reservation", { reservedTokens: { $subtract: ["$$reservation.reservedTokens", requested] } }] }, "$$reservation"] } } },
            } },
            { $set: { activeReservations: { $filter: { input: "$activeReservations", as: "reservation", cond: { $gt: ["$$reservation.reservedTokens", 0] } } } } },
        ],
        { new: true },
    );
    if (!account) {
        const current = await ensureAccount(owner);
        throw quotaError(quotaSnapshot(current), "The provider usage exceeded the token reservation for this AI call.");
    }
    return quotaSnapshot(account);
}

export async function releaseReservedTokens(owner, operationId, reservationId) {
    const account = await TokenAccount.findOneAndUpdate(
        { owner, activeReservations: { $elemMatch: { operationId, reservationId } } },
        [
            { $set: {
                reservedTokens: { $subtract: ["$reservedTokens", { $let: { vars: { reservation: { $arrayElemAt: [{ $filter: { input: "$activeReservations", as: "item", cond: { $and: [{ $eq: ["$$item.operationId", operationId] }, { $eq: ["$$item.reservationId", reservationId] }] } } }, 0] } }, in: "$$reservation.reservedTokens" } }] },
                activeReservations: { $filter: { input: "$activeReservations", as: "reservation", cond: { $not: { $and: [{ $eq: ["$$reservation.operationId", operationId] }, { $eq: ["$$reservation.reservationId", reservationId] }] } } } },
            } },
        ],
        { new: true },
    );
    return account ? quotaSnapshot(account) : getTokenQuota(owner);
}

export function isQuotaError(error) { return error?.code === "AI_TOKEN_QUOTA_EXCEEDED" || error?.code === "AI_TOKEN_RESERVATION_EXCEEDED"; }
