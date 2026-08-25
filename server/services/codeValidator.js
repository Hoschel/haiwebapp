// Post-generation code validator and auto-fixer.
// This module intentionally stays dependency-free so it can run in the generation worker.

const VOID_ELEMENTS = ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"];

function stripLiteralsAndComments(source) {
    let output = "";
    let mode = "code";
    let quote = "";
    let escaped = false;

    for (let i = 0; i < source.length; i += 1) {
        const char = source[i];
        const next = source[i + 1];

        if (mode === "lineComment") {
            if (char === "\n") { mode = "code"; output += "\n"; }
            else output += " ";
            continue;
        }
        if (mode === "blockComment") {
            if (char === "*" && next === "/") { mode = "code"; output += "  "; i += 1; }
            else output += char === "\n" ? "\n" : " ";
            continue;
        }
        if (mode === "string") {
            if (escaped) { escaped = false; output += " "; continue; }
            if (char === "\\") { escaped = true; output += " "; continue; }
            if (char === quote) { mode = "code"; output += " "; }
            else output += char === "\n" ? "\n" : " ";
            continue;
        }

        if (char === "/" && next === "/") { mode = "lineComment"; output += "  "; i += 1; continue; }
        if (char === "/" && next === "*") { mode = "blockComment"; output += "  "; i += 1; continue; }
        if (["'", '"', "`"].includes(char)) { mode = "string"; quote = char; output += " "; continue; }
        output += char;
    }

    return output;
}

export function inspectGeneratedCode(code, filePath, context = {}) {
    const errors = [];
    const isCSS = /\.css$/i.test(filePath);
    const isJS = /\.(js|jsx)$/i.test(filePath);
    if (!isJS || isCSS) return errors;

    const clean = stripLiteralsAndComments(code);
    const stack = [];
    const pairs = { "(": ")", "[": "]", "{": "}" };

    for (const char of clean) {
        if (pairs[char]) stack.push(char);
        else if ([")", "]", "}"].includes(char)) {
            const open = stack.pop();
            if (!open || pairs[open] !== char) {
                errors.push(`Unbalanced delimiter: unexpected '${char}'`);
                break;
            }
        }
    }
    if (stack.length > 0) errors.push(`Unbalanced delimiter: missing closing '${pairs[stack[stack.length - 1]]}'`);

    if (/<[A-Za-z]/.test(code) && !/import\s+(?:React|\{[^}]*\})\s+from\s+['"]react['"]/.test(code)) {
        errors.push("JSX is present but React is not imported");
    }

    if ((code.match(/export\s+default\s+/g) || []).length > 1) errors.push("Multiple default exports detected");

    const plannedPaths = new Set((context.allPlannedFiles || []).map((file) => file.path));
    const imports = [...code.matchAll(/(?:from\s+|import\s*\(|import\s+)(['"])(\.\.?\/[^'"]+)\1/g)].map((match) => match[2]);
    for (const importPath of imports) {
        if (!plannedPaths.size) continue;
        const candidates = [importPath, `${importPath}.js`, `${importPath}.jsx`, `${importPath}/index.js`, `${importPath}/index.jsx"]`];
        if (!candidates.some((candidate) => plannedPaths.has(candidate.startsWith("/") ? candidate : `/${candidate.replace(/^\.\//, "")}`))) {
            // Imports can legitimately resolve to Vite virtual paths; only report likely local-file misses.
            if (/^\.\.?\//.test(importPath)) errors.push(`Local import does not match a planned file: ${importPath}`);
        }
    }

    return [...new Set(errors)];
}

export function validateAndFixCode(code, filePath, context) {
    const warnings = [];
    const isCSS = filePath.endsWith(".css");
    const isJS = filePath.endsWith(".js") || filePath.endsWith(".jsx");

    const fencePattern = /^```(?:jsx?|javascript|css|html|tsx?|react)?\s*\n([\s\S]*?)\n```\s*$/;
    const fenceMatch = code.match(fencePattern);
    if (fenceMatch) {
        code = fenceMatch[1];
        warnings.push(`${filePath}: Stripped markdown code fences`);
    }
    code = code.replace(/^```(?:jsx?|javascript|css|html|tsx?|react)?\s*\n/, "");
    code = code.replace(/\n```\s*$/, "");

    if (isCSS) return { code: code.trim() + "\n", warnings };
    if (!isJS) return { code, warnings };

    const classFixRegex = /(<[a-zA-Z][^>]*?)\bclass=/g;
    if (classFixRegex.test(code)) {
        code = code.replace(/(<[a-zA-Z][^>]*?)\bclass=/g, "$1className=");
        warnings.push(`${filePath}: Fixed 'class=' → 'className='`);
    }

    const forFixRegex = /(<label[^>]*?)\bfor=/gi;
    if (forFixRegex.test(code)) {
        code = code.replace(/(<label[^>]*?)\bfor=/gi, "$1htmlFor=");
        warnings.push(`${filePath}: Fixed 'for=' → 'htmlFor='`);
    }

    for (const tag of VOID_ELEMENTS) {
        const voidRegex = new RegExp(`<${tag}(\\s[^>]*?)?(?<!/)>`, "gi");
        if (voidRegex.test(code)) {
            code = code.replace(new RegExp(`<${tag}(\\s[^>]*?)?(?<!/)>`, "gi"), (match, attrs) => `<${tag}${attrs || ""} />`);
            warnings.push(`${filePath}: Self-closed <${tag}> elements`);
        }
    }

    const defaultExportCount = (code.match(/export\s+default\s+/g) || []).length;
    if (defaultExportCount === 0) {
        const funcMatch = code.match(/^function\s+([A-Z]\w*)\s*\(/m);
        const constMatch = code.match(/^const\s+([A-Z]\w*)\s*=\s*(?:\(|function)/m);
        const componentName = funcMatch?.[1] || constMatch?.[1];
        if (componentName) {
            const namedExportRegex = new RegExp(`export\\s+(function|const)\\s+${componentName}`);
            if (namedExportRegex.test(code)) code = code.replace(new RegExp(`export\\s+(function|const)\\s+${componentName}`), `export default $1 ${componentName}`);
            else code = `${code.trimEnd()}\n\nexport default ${componentName};\n`;
            warnings.push(`${filePath}: Added missing default export for '${componentName}'`);
        }
    }

    const htmlCommentRegex = /<!--[\s\S]*?-->/g;
    if (htmlCommentRegex.test(code)) {
        code = code.replace(htmlCommentRegex, "");
        warnings.push(`${filePath}: Removed HTML comments (invalid in JSX)`);
    }

    code = code.replace(/:\s*React\.FC(?:<[^>]*>)?\s*=/g, () => { warnings.push(`${filePath}: Removed TypeScript React.FC annotation`); return " ="; });
    code = code.replace(/(\([^)]*?)\s*:\s*(?:string|number|boolean|any|object|void)\s*([,)])/g, (match, before, after) => { warnings.push(`${filePath}: Removed TypeScript type annotation`); return `${before}${after}`; });

    if (/<[A-Za-z]/.test(code) && !/import\s+React/.test(code)) {
        code = `import React from 'react';\n${code}`;
        warnings.push(`${filePath}: Added missing React import`);
    }

    if (context?.allPlannedFiles) {
        const fixResult = fixImportPaths(code, filePath, context.allPlannedFiles);
        code = fixResult.code;
        warnings.push(...fixResult.warnings);
    }

    return { code: code.trim() + "\n", warnings };
}

export function validateRevisionContent(content, filePath, op) {
    if (op === "delete") return { content, warnings: [] };
    if (op === "create") {
        const result = validateAndFixCode(content, filePath);
        return { content: result.code, warnings: result.warnings };
    }
    const warnings = [];
    const classFixRegex = /(<[a-zA-Z][^>]*?)\bclass=/g;
    if (classFixRegex.test(content)) { content = content.replace(/(<[a-zA-Z][^>]*?)\bclass=/g, "$1className="); warnings.push(`${filePath}: Fixed 'class=' in replacement`); }
    const forFixRegex = /(<label[^>]*?)\bfor=/gi;
    if (forFixRegex.test(content)) { content = content.replace(/(<label[^>]*?)\bfor=/gi, "$1htmlFor="); warnings.push(`${filePath}: Fixed 'for=' in replacement`); }
    for (const tag of VOID_ELEMENTS) {
        const regex = new RegExp(`<${tag}(\\s[^>]*?)?(?<!/)>`, "gi");
        if (regex.test(content)) content = content.replace(regex, (match, attrs) => `<${tag}${attrs || ""} />`);
    }
    return { content, warnings };
}

function getDir(p) {
    const parts = p.split("/"); parts.pop(); return parts.join("/") || "/";
}
function resolvePath(baseDir, relativePath) {
    const baseParts = baseDir.split("/").filter(Boolean);
    for (const part of relativePath.split("/").filter(Boolean)) {
        if (part === ".") continue;
        if (part === "..") baseParts.pop();
        else baseParts.push(part);
    }
    return "/" + baseParts.join("/");
}
function getRelativePath(fromDir, toPath) {
    const fromParts = fromDir.split("/").filter(Boolean);
    const toParts = toPath.split("/").filter(Boolean);
    let commonLength = 0;
    while (commonLength < fromParts.length && commonLength < toParts.length && fromParts[commonLength] === toParts[commonLength]) commonLength += 1;
    const relParts = Array.from({ length: fromParts.length - commonLength }, () => "..");
    const remaining = toParts.slice(commonLength);
    if (!relParts.length) relParts.push(".");
    relParts.push(...remaining);
    return relParts.join("/");
}
function cleanExtension(p) { return p.replace(/\.(js|jsx|css|ts|tsx)$/, ""); }
function fixImportPaths(code, filePath, allPlannedFiles) {
    const warnings = [];
    if (!allPlannedFiles?.length) return { code, warnings };
    const currentDir = getDir(filePath);
    const plannedPaths = allPlannedFiles.map((f) => f.path.startsWith("/") ? f.path : `/${f.path}`);
    const importRegex = /(from\s+['"]|import\s+['"])([^'"]+)(['"])/g;
    const newCode = code.replace(importRegex, (match, prefix, importTarget, suffix) => {
        if (!importTarget.startsWith(".")) return match;
        const resolvedClean = cleanExtension(resolvePath(currentDir, importTarget));
        if (plannedPaths.some((p) => cleanExtension(p) === resolvedClean)) return match;
        const importFilename = resolvedClean.split("/").pop();
        if (!importFilename) return match;
        const found = plannedPaths.find((p) => cleanExtension(p).split("/").pop() === importFilename);
        if (!found) return match;
        const relative = getRelativePath(currentDir, found);
        const finalRelative = relative.startsWith(".") ? relative : `./${relative}`;
        const hasExt = /\.(js|jsx|css|ts|tsx)$/.test(importTarget);
        const ext = hasExt ? `.${importTarget.split(".").pop()}` : "";
        const rewritten = cleanExtension(finalRelative) + ext;
        if (rewritten === importTarget) return match;
        warnings.push(`${filePath}: Corrected import '${importTarget}' to '${rewritten}'`);
        return `${prefix}${rewritten}${suffix}`;
    });
    return { code: newCode, warnings };
}
