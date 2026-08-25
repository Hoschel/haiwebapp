function normalizePath(path) {
    if (!path) return "/";
    const value = path.replace(/\\/g, "/");
    return value.startsWith("/") ? value : `/${value}`;
}

function stripQuery(path) {
    return path.split("?")[0].split("#")[0];
}

function resolveImport(fromPath, importPath, filePaths) {
    if (!importPath?.startsWith(".")) return null;
    const from = normalizePath(fromPath);
    const base = from.slice(0, from.lastIndexOf("/") + 1);
    const parts = `${base}${importPath}`.split("/");
    const normalized = [];
    for (const part of parts) {
        if (!part || part === ".") continue;
        if (part === "..") normalized.pop();
        else normalized.push(part);
    }
    const candidate = `/${normalized.join("/")}`;
    const candidates = [candidate, `${candidate}.js`, `${candidate}.jsx`, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}/index.js`, `${candidate}/index.jsx`, `${candidate}/index.ts`, `${candidate}/index.tsx`, `${candidate}.css`];
    return candidates.find((path) => filePaths.has(path)) || null;
}

function extractImports(code) {
    const imports = new Set();
    const patterns = [
        /\bimport\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
        /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
        /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    ];
    for (const pattern of patterns) {
        for (const match of code.matchAll(pattern)) imports.add(match[1]);
    }
    return [...imports];
}

export function buildDependencyGraph(files) {
    const entries = Object.entries(files || {});
    const filePaths = new Set(entries.map(([path]) => normalizePath(stripQuery(path))));
    const graph = {};
    const unresolved = [];

    for (const [rawPath, value] of entries) {
        const path = normalizePath(stripQuery(rawPath));
        const code = typeof value === "string" ? value : value?.content || "";
        const dependencies = [];
        const external = [];

        for (const importPath of extractImports(code)) {
            const resolved = resolveImport(path, importPath, filePaths);
            if (resolved) dependencies.push(resolved);
            else if (importPath.startsWith(".")) unresolved.push({ from: path, import: importPath });
            else external.push(importPath);
        }

        graph[path] = { dependencies: [...new Set(dependencies)], dependents: [], external: [...new Set(external)] };
    }

    for (const [path, node] of Object.entries(graph)) {
        for (const dependency of node.dependencies) {
            if (graph[dependency]) graph[dependency].dependents.push(path);
        }
    }

    return { graph, unresolved };
}

export function getAffectedFiles(graphResult, changedPaths, options = {}) {
    const includeDependents = options.includeDependents !== false;
    const includeDependencies = options.includeDependencies !== false;
    const result = new Set((changedPaths || []).map(normalizePath));
    const queue = [...result];

    while (queue.length) {
        const current = queue.shift();
        const node = graphResult.graph[current];
        if (!node) continue;
        const related = [...(includeDependents ? node.dependents : []), ...(includeDependencies ? node.dependencies : [])];
        for (const path of related) {
            if (!result.has(path)) {
                result.add(path);
                queue.push(path);
            }
        }
    }
    return [...result];
}

export function getDependencyReport(graphResult) {
    return {
        files: Object.keys(graphResult.graph).length,
        edges: Object.values(graphResult.graph).reduce((sum, node) => sum + node.dependencies.length, 0),
        unresolvedImports: graphResult.unresolved,
        orphanFiles: Object.entries(graphResult.graph).filter(([, node]) => node.dependencies.length === 0 && node.dependents.length === 0).map(([path]) => path),
    };
}
