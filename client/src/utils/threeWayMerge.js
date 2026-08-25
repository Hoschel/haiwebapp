function splitLines(value) {
    return String(value ?? "").replace(/\r\n/g, "\n").split("\n");
}

function commonPrefix(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    return i;
}

function commonSuffix(a, b, prefix) {
    let i = 0;
    while (a.length - 1 - i >= prefix && b.length - 1 - i >= prefix && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
    return i;
}

export function threeWayMerge(base, local, remote) {
    if (local === remote) return { content: local, conflicts: [], clean: true };
    if (local === base) return { content: remote, conflicts: [], clean: true };
    if (remote === base) return { content: local, conflicts: [], clean: true };

    const baseLines = splitLines(base);
    const localLines = splitLines(local);
    const remoteLines = splitLines(remote);
    const prefix = commonPrefix(localLines, remoteLines);
    const suffix = commonSuffix(localLines, remoteLines, prefix);
    const localChanged = localLines.slice(prefix, localLines.length - suffix);
    const remoteChanged = remoteLines.slice(prefix, remoteLines.length - suffix);
    const baseChanged = baseLines.slice(Math.min(prefix, baseLines.length), Math.max(Math.min(prefix, baseLines.length), baseLines.length - suffix));

    // A single disjoint edit can be merged safely. For overlapping edits,
    // return a standard conflict marker instead of silently choosing a side.
    const sameBaseRegion = baseChanged.join("\n") === localChanged.join("\n") || baseChanged.join("\n") === remoteChanged.join("\n");
    if (sameBaseRegion) {
        const merged = localChanged.join("\n") === baseChanged.join("\n") ? remoteChanged : localChanged;
        return {
            content: [...localLines.slice(0, prefix), ...splitLines(merged), ...localLines.slice(localLines.length - suffix)].join("\n"),
            conflicts: [],
            clean: true,
        };
    }

    const conflictId = `conflict-${Date.now()}`;
    const content = [
        ...localLines.slice(0, prefix),
        `<<<<<<< LOCAL ${conflictId}`,
        ...localChanged,
        "=======",
        ...remoteChanged,
        `>>>>>>> REMOTE ${conflictId}`,
        ...localLines.slice(localLines.length - suffix),
    ].join("\n");

    return {
        content,
        clean: false,
        conflicts: [{ id: conflictId, base, local, remote, startLine: prefix + 1 }],
    };
}

export function mergeFileMaps(baseFiles, localFiles, remoteFiles) {
    const paths = new Set([...Object.keys(baseFiles || {}), ...Object.keys(localFiles || {}), ...Object.keys(remoteFiles || {})]);
    const merged = {};
    const conflicts = [];
    for (const path of paths) {
        const base = typeof baseFiles?.[path] === "string" ? baseFiles[path] : baseFiles?.[path]?.content || "";
        const local = typeof localFiles?.[path] === "string" ? localFiles[path] : localFiles?.[path]?.content || "";
        const remote = typeof remoteFiles?.[path] === "string" ? remoteFiles[path] : remoteFiles?.[path]?.content || "";
        const result = threeWayMerge(base, local, remote);
        if (result.content !== "" || local !== undefined || remote !== undefined) merged[path] = result.content;
        if (result.conflicts.length) conflicts.push(...result.conflicts.map((conflict) => ({ ...conflict, path })));
    }
    return { files: merged, conflicts, clean: conflicts.length === 0 };
}

export function resolveConflict(content, strategy) {
    const lines = splitLines(content);
    const output = [];
    let mode = "normal";
    for (const line of lines) {
        if (line.startsWith("<<<<<<< LOCAL")) { mode = strategy === "remote" ? "skip-local" : "local"; continue; }
        if (line === "=======") { mode = strategy === "local" ? "skip-remote" : "remote"; continue; }
        if (line.startsWith(">>>>>>> REMOTE")) { mode = "normal"; continue; }
        if (mode === "normal" || mode === "local" || mode === "remote") output.push(line);
    }
    return output.join("\n");
}
