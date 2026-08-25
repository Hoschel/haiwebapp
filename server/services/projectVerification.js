import { analyzeProjectIntegrity, getCriticalIntegrityErrors } from "./projectIntegrity.js";

export function verifyProject(files, runtime = {}, version = null) {
    const integrity = analyzeProjectIntegrity(files);
    const criticalErrors = getCriticalIntegrityErrors(integrity);
    const staticStatus = integrity.ok ? "passed" : "failed";
    // A passed runtime result without a persisted version is never trusted.
    // When the caller supplies the project version, require an exact match;
    // when it does not (for example legacy publish callers), require at least
    // a versioned runtime result rather than accepting old unversioned data.
    const runtimeMatchesVersion = version == null ? Number.isInteger(runtime.version) : runtime.version === version;
    const runtimeStatus = runtimeMatchesVersion ? (runtime.status || "pending") : "pending";
    const runtimeOk = runtimeStatus !== "failed";
    return {
        status: integrity.ok && runtimeOk ? (runtimeStatus === "passed" ? "verified" : "pending_runtime") : "failed",
        static: {
            status: staticStatus,
            checkedAt: new Date(),
            errors: criticalErrors,
            unresolvedImports: integrity.unresolvedImports,
            syntaxErrors: integrity.syntaxErrors,
        },
        runtime: {
            status: runtimeStatus,
            checkedAt: runtimeMatchesVersion ? (runtime.checkedAt || null) : null,
            error: runtimeMatchesVersion ? (runtime.error || null) : null,
            version: runtimeMatchesVersion ? (runtime.version ?? null) : null,
        },
    };
}

export function withRuntimeVerification(files, previousVerification, runtime, version = null) {
    return verifyProject(files, { ...(previousVerification?.runtime || {}), ...runtime, version, checkedAt: new Date() }, version);
}
