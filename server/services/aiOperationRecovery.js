import { AIOperation } from "../models/AIOperation.js";
import { Project } from "../models/Project.js";
import { TokenAccount } from "../models/TokenAccount.js";

const intEnv = (name, fallback, min, max) => {
    const value = Number.parseInt(process.env[name] || "", 10);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
};

export const AI_OPERATION_RECOVERY = Object.freeze({
    staleAfterMs: intEnv("AI_OPERATION_STALE_AFTER_MS", 15 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000),
});

export async function recoverStaleAIOperations({ now = new Date() } = {}) {
    const cutoff = new Date(now.getTime() - AI_OPERATION_RECOVERY.staleAfterMs);
    const staleOperations = await AIOperation.find(
        { status: "running", startedAt: { $lt: cutoff } },
        { operationId: 1, project: 1 },
    ).lean();
    const operationIds = staleOperations.map((operation) => operation.operationId);

    const result = operationIds.length
        ? await AIOperation.updateMany(
            { operationId: { $in: operationIds }, status: "running" },
            { $set: { status: "failed", error: "AI operation became stale and was recovered after a server restart or worker interruption", completedAt: now } },
        )
        : { modifiedCount: 0 };

    if (operationIds.length) {
        await Project.updateMany(
            { generationOperationId: { $in: operationIds }, status: { $in: ["pending", "generating", "revising"] } },
            { $set: { status: "failed", generationStage: "failed", generationOperationId: null, currentFile: null, error: "AI operation was interrupted and recovered after a server restart" } },
        );
    }

    // Provider-call reservations are deliberately short-lived. If a worker
    // dies before releasing one, return it to the user's available balance.
    const reservationRecovery = await TokenAccount.updateMany(
        { "activeReservations.createdAt": { $lt: cutoff } },
        [
            { $set: {
                reservedTokens: {
                    $max: [0, { $subtract: ["$reservedTokens", { $reduce: { input: { $filter: { input: "$activeReservations", as: "reservation", cond: { $lt: ["$$reservation.createdAt", cutoff] } } }, initialValue: 0, in: { $add: ["$$value", "$$this.reservedTokens"] } } }] }],
                },
                activeReservations: { $filter: { input: "$activeReservations", as: "reservation", cond: { $gte: ["$$reservation.createdAt", cutoff] } } },
            } },
        ],
    );

    return {
        recovered: result.modifiedCount ?? result.nModified ?? 0,
        reservationsRecovered: reservationRecovery.modifiedCount ?? reservationRecovery.nModified ?? 0,
        cutoff,
    };
}
