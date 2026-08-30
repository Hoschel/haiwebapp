import { AIOperation } from "../models/AIOperation.js";
import { Project } from "../models/Project.js";

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
    if (!staleOperations.length) return { recovered: 0, cutoff };

    const operationIds = staleOperations.map((operation) => operation.operationId);
    const result = await AIOperation.updateMany(
        { operationId: { $in: operationIds }, status: "running" },
        {
            $set: {
                status: "failed",
                error: "AI operation became stale and was recovered after a server restart or worker interruption",
                completedAt: now,
            },
        },
    );

    await Project.updateMany(
        {
            generationOperationId: { $in: operationIds },
            status: { $in: ["pending", "generating", "revising"] },
        },
        {
            $set: {
                status: "failed",
                generationStage: "failed",
                generationOperationId: null,
                currentFile: null,
                error: "AI operation was interrupted and recovered after a server restart",
            },
        },
    );

    return { recovered: result.modifiedCount ?? result.nModified ?? 0, cutoff };
}
