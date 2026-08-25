import { analyzeProjectIntegrity, getCriticalIntegrityErrors } from "./projectIntegrity.js";
import { validateProjectBuild } from "./projectBuildValidator.js";

export function verifyProject(files, runtime = {}, version = null) {
    const integrity = analyzeProjectIntegrity(files);
    const criticalErrors = getCriticalIntegrityErrors(integrity);
    const build = validateProjectBuild(files);
    const staticStatus = integrity.ok && build.status === "passed" ? "passed" : "failed";
    const runtimeMatchesVersion = version == null ? Number.isInteger(runtime.version) : runtime.version === version;
    const runtimeStatus = runtimeMatchesVersion ? (runtime.status || "pending") : "pending";
    const runtimeOk = runtimeStatus !== "failed";
    const staticErrors = [...criticalErrors, ...build.errors.map((item) => `${item.path || "project"}: ${item.error}`)];
    return {
        status: staticStatus === "passed" && runtimeOk ? (runtimeStatus === "passed" ? "verified" : "pending_runtime") : "failed",
        static: {
            status: staticStatus,
            checkedAt: new Date(),
            errors: staticErrors,
            unresolvedImports: integrity.unresolvedImports,
            syntaxErrors: integrity.syntaxErrors,
        },
        build,
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
