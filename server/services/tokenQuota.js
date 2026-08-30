import { TokenAccount } from "../models/TokenAccount.js";

const intEnv = (name, fallback, min, max) => {
    const value = Number.parseInt(process.env[name] || "", 10);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
};

export const TOKEN_QUOTA = Object.freeze({
    dailyFreeTokens: intEnv("DAILY_FREE_TOKENS", 1_000_000, 1, 100_000_000),
    reservationChunk: intEnv("AI_TOKEN_RESERVATION_CHUNK", 200_000, 10_000, 1_000_000),
    topUpThreshold: intEnv("AI_TOKEN_RESERVATION_TOPUP_THRESHOLD", 100_000, 1_000, 500_000),
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
    const available = Math.max(0, account.freeRemaining + account.paidBalance - account.reservedTokens);
    return {
        dailyFreeLimit: account.dailyFreeLimit,
        freeRemaining: account.freeRemaining,
        paidBalance: account.paidBalance,
        reservedTokens: account.reservedTokens,
        available,
        freeResetAt: account.freeResetAt,
    };
}

export async function getTokenQuota(owner) {
    return quotaSnapshot(await ensureAccount(owner));
}

export async function reserveTokens(owner, operationId, amount = TOKEN_QUOTA.reservationChunk) {
    const requested = asTokens(amount);
    if (!requested || !operationId) throw new Error("Token reservation requires an operationId and a positive amount");
    await ensureAccount(owner);

    const availableExpression = { $subtract: [{ $add: ["$freeRemaining", "$paidBalance"] }, "$reservedTokens"] };
    const account = await TokenAccount.findOneAndUpdate(
        {
            owner,
            "activeReservations.operationId": { $ne: operationId },
            $expr: { $gte: [availableExpression, requested] },
        },
        {
            $inc: { reservedTokens: requested },
            $push: { activeReservations: { operationId, reservedTokens: requested, createdAt: new Date() } },
        },
        { new: true },
    );

    if (!account) {
        const current = await ensureAccount(owner);
        const snapshot = quotaSnapshot(current);
        const error = new Error(snapshot.freeRemaining === 0 && snapshot.paidBalance === 0 && snapshot.reservedTokens === 0
            ? "Daily token limit reached. Wait until the free token reset time or purchase additional tokens to continue."
            : "Not enough available tokens for this AI operation.");
        error.status = 402;
        error.code = "AI_TOKEN_QUOTA_EXCEEDED";
        error.quota = snapshot;
        throw error;
    }
    return quotaSnapshot(account);
}

export async function topUpReservation(owner, operationId, amount = TOKEN_QUOTA.reservationChunk) {
    const requested = asTokens(amount);
    if (!requested) return getTokenQuota(owner);
    const availableExpression = { $subtract: [{ $add: ["$freeRemaining", "$paidBalance"] }, "$reservedTokens"] };
    const account = await TokenAccount.findOneAndUpdate(
        { owner, "activeReservations.operationId": operationId, $expr: { $gte: [availableExpression, requested] } },
        [
            { $set: {
                reservedTokens: { $add: ["$reservedTokens", requested] },
                activeReservations: { $map: { input: "$activeReservations", as: "reservation", in: { $cond: [{ $eq: ["$$reservation.operationId", operationId] }, { $mergeObjects: ["$$reservation", { reservedTokens: { $add: ["$$reservation.reservedTokens", requested] } }] }, "$$reservation"] } } },
            } },
        ],
        { new: true },
    );
    if (!account) {
        const current = await ensureAccount(owner);
        const error = new Error("Token quota is exhausted. Wait for the free reset or purchase additional tokens.");
        error.status = 402;
        error.code = "AI_TOKEN_QUOTA_EXCEEDED";
        error.quota = quotaSnapshot(current);
        throw error;
    }
    return quotaSnapshot(account);
}

export async function consumeReservedTokens(owner, operationId, amount) {
    const requested = asTokens(amount);
    if (!requested) return getTokenQuota(owner);
    const account = await TokenAccount.findOneAndUpdate(
        { owner, "activeReservations.operationId": operationId, "activeReservations.reservedTokens": { $gte: requested } },
        [
            { $set: {
                freeRemaining: { $subtract: ["$freeRemaining", { $min: [requested, "$freeRemaining"] }] },
                paidBalance: { $subtract: ["$paidBalance", { $max: [0, { $subtract: [requested, "$freeRemaining"] }] }] },
                reservedTokens: { $subtract: ["$reservedTokens", requested] },
                activeReservations: { $map: { input: "$activeReservations", as: "reservation", in: { $cond: [{ $eq: ["$$reservation.operationId", operationId] }, { $mergeObjects: ["$$reservation", { reservedTokens: { $subtract: ["$$reservation.reservedTokens", requested] } }] }, "$$reservation"] } } },
            } },
            { $set: { activeReservations: { $filter: { input: "$activeReservations", as: "reservation", cond: { $gt: ["$$reservation.reservedTokens", 0] } } } } },
        ],
        { new: true },
    );
    if (!account) {
        const error = new Error("AI token reservation was exhausted before provider usage could be charged");
        error.status = 402;
        error.code = "AI_TOKEN_RESERVATION_EXCEEDED";
        throw error;
    }
    return quotaSnapshot(account);
}

export async function releaseReservedTokens(owner, operationId) {
    const account = await TokenAccount.findOneAndUpdate(
        { owner, "activeReservations.operationId": operationId },
        [
            { $set: {
                reservedTokens: { $subtract: ["$reservedTokens", { $let: { vars: { reservation: { $arrayElemAt: [{ $filter: { input: "$activeReservations", as: "item", cond: { $eq: ["$$item.operationId", operationId] } } }, 0] } }, in: "$$reservation.reservedTokens" } }] },
                activeReservations: { $filter: { input: "$activeReservations", as: "reservation", cond: { $ne: ["$$reservation.operationId", operationId] } } },
            } },
        ],
        { new: true },
    );
    return account ? quotaSnapshot(account) : getTokenQuota(owner);
}

export function isQuotaError(error) { return error?.code === "AI_TOKEN_QUOTA_EXCEEDED" || error?.code === "AI_TOKEN_RESERVATION_EXCEEDED"; }
