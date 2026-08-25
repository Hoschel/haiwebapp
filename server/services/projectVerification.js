import { analyzeProjectIntegrity, getCriticalIntegrityErrors } from "./projectIntegrity.js";

export function verifyProject(files, runtime = {}) {
    const integrity = analyzeProjectIntegrity(files);
    const criticalErrors = getCriticalIntegrityErrors(integrity);
    const staticStatus = integrity.ok ? "passed" : "failed";
    const runtimeStatus = runtime.status || "pending";
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
            checkedAt: runtime.checkedAt || null,
            error: runtime.error || null,
        },
    };
}

export function withRuntimeVerification(files, previousVerification, runtime) {
    return verifyProject(files, { ...(previousVerification?.runtime || {}), ...runtime, checkedAt: new Date() });
}
