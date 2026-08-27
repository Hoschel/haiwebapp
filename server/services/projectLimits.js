const intEnv = (name, fallback, min, max) => {
    const value = Number.parseInt(process.env[name] || "", 10);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
};

export const PROJECT_LIMITS = Object.freeze({
    maxFiles: intEnv("PROJECT_MAX_FILES", 120, 1, 1000),
    maxFileBytes: intEnv("PROJECT_MAX_FILE_BYTES", 512 * 1024, 1024, 5 * 1024 * 1024),
    maxTotalBytes: intEnv("PROJECT_MAX_TOTAL_BYTES", 4 * 1024 * 1024, 1024, 20 * 1024 * 1024),
    maxPromptChars: intEnv("PROJECT_MAX_PROMPT_CHARS", 12000, 100, 100000),
});

const byteLength = (value) => Buffer.byteLength(String(value ?? ""), "utf8");

export function validateProjectFiles(files) {
    const entries = Object.entries(files || {});
    if (entries.length > PROJECT_LIMITS.maxFiles) throw Object.assign(new Error(`Project exceeds the ${PROJECT_LIMITS.maxFiles}-file limit`), { status: 413, code: "PROJECT_FILE_COUNT_LIMIT" });
    let total = 0;
    for (const [path, content] of entries) {
        const bytes = byteLength(content);
        if (bytes > PROJECT_LIMITS.maxFileBytes) throw Object.assign(new Error(`File ${path} exceeds the ${PROJECT_LIMITS.maxFileBytes}-byte limit`), { status: 413, code: "PROJECT_FILE_SIZE_LIMIT", path });
        total += bytes;
    }
    if (total > PROJECT_LIMITS.maxTotalBytes) throw Object.assign(new Error(`Project exceeds the ${PROJECT_LIMITS.maxTotalBytes}-byte total limit`), { status: 413, code: "PROJECT_TOTAL_SIZE_LIMIT" });
    return { fileCount: entries.length, totalBytes: total };
}

export function assertPromptSize(prompt) {
    const chars = String(prompt ?? "").length;
    if (chars > PROJECT_LIMITS.maxPromptChars) throw Object.assign(new Error(`Prompt exceeds the ${PROJECT_LIMITS.maxPromptChars}-character limit`), { status: 413, code: "PROMPT_SIZE_LIMIT" });
    return chars;
}
