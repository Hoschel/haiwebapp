import { buildDependencyGraph, getDependencyReport } from "./dependencyGraph.js";
import { inspectGeneratedCode } from "./codeValidator.js";

function entriesOf(files) {
    if (!files) return [];
    return files instanceof Map ? [...files.entries()] : Object.entries(files);
}

function contentOf(entry) {
    return typeof entry === "string" ? entry : entry?.content || "";
}

export function analyzeProjectIntegrity(files) {
    const normalized = Object.fromEntries(entriesOf(files).map(([path, entry]) => [path, contentOf(entry)]));
    const dependency = buildDependencyGraph(normalized);
    const syntax = [];

    for (const [path, content] of Object.entries(normalized)) {
        const errors = inspectGeneratedCode(content, path, { allPlannedFiles: Object.keys(normalized).map((filePath) => ({ path: filePath })) });
        for (const error of errors) syntax.push({ path, error });
    }

    const report = getDependencyReport(dependency);
    return {
        ok: syntax.length === 0 && report.unresolvedImports.length === 0,
        syntaxErrors: syntax,
        unresolvedImports: report.unresolvedImports,
        orphanFiles: report.orphanFiles,
        dependency: report,
    };
}

export function getCriticalIntegrityErrors(report) {
    return [
        ...report.syntaxErrors.map((item) => `${item.path}: ${item.error}`),
        ...report.unresolvedImports.map((item) => `${item.from}: unresolved local import ${item.import}`),
    ];
}
