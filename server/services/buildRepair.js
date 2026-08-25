export function createBuildRepairPrompt(verification, attempt = 1) {
    const buildErrors = verification?.build?.errors || [];
    const staticErrors = verification?.static?.errors || [];
    const errors = [...buildErrors, ...staticErrors].slice(0, 20);
    const formatted = errors.length
        ? errors.map((item) => typeof item === "string" ? item : `${item.path || "project"}: ${item.error || "Validation failed"}`).join("\n")
        : "Project validation failed without a structured error.";

    return [
        "AUTOMATIC BUILD REPAIR",
        `Repair attempt ${attempt}.`,
        "The previous AI revision introduced or left static/build validation errors.",
        "Fix only the minimum files necessary. Preserve the existing UI, features, and unrelated code.",
        "Do not add merge markers, placeholder implementations, or redesign the project.",
        "Return normal revision operations for the current project state.",
        "Validation errors:",
        formatted,
    ].join("\n\n");
}
