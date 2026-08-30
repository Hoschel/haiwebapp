import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import pMap from "p-map";
import { FileCodeSchema, FilePlanSchema, RevisionResultSchema } from "./aiSchemas.js";
import { buildFileCodeSystem, FILE_PLAN_SYSTEM, REVISE_SYSTEM } from "./prompts.js";
import { normalizeContent } from "./contentNormalizer.js";
import { inspectGeneratedCode, validateAndFixCode, validateRevisionContent } from "./codeValidator.js";
import { selectRelevantFiles } from "./fileRelevance.js";
import { buildDependencyGraph, getAffectedFiles, getDependencyReport } from "./dependencyGraph.js";
import { analyzeProjectIntegrity, getCriticalIntegrityErrors } from "./projectIntegrity.js";
import { validateProjectBuild } from "./projectBuildValidator.js";
import { PROJECT_LIMITS, validateProjectFiles, assertPromptSize } from "./projectLimits.js";
import { AI_OPERATION_LIMITS, createOperationBudget, createBudgetedProviderCall } from "./aiOperationBudget.js";

const MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";
const MAX_CONCURRENCY = Math.max(1, parseInt(process.env.AI_MAX_CONCURRENCY || "4", 10) || 4);
const MAX_GENERATION_REPAIRS = Math.max(0, Math.min(parseInt(process.env.AI_GENERATION_REPAIRS || "2", 10) || 2, 3));
const MAX_INTEGRITY_REPAIRS = Math.max(0, Math.min(parseInt(process.env.AI_INTEGRITY_REPAIRS || "2", 10) || 2, 3));
const MAX_BUILD_REPAIRS = Math.max(0, Math.min(parseInt(process.env.AI_BUILD_REPAIRS || "2", 10) || 2, 3));
const MAX_REVISION_FILES = Math.max(3, Math.min(parseInt(process.env.AI_REVISION_MAX_FILES || "12", 10) || 12, 30));
const MAX_REVISION_CONTEXT = Math.max(10000, Math.min(parseInt(process.env.AI_REVISION_MAX_CONTEXT || "50000", 10) || 50000, 100000));
const openrouter = createOpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY });
const model = openrouter(MODEL);

async function emitStage(callbacks, stage) { if (callbacks?.onStage) await callbacks.onStage(stage); }
function normalizePath(path) { return path.startsWith("/") ? path : `/${path}`; }
function getGenerationPriority(file) { const path = file.path.toLowerCase(); if (["/app.js", "/app.jsx", "/styles.css"].includes(path) || path.includes("package.json")) return 0; if (path.includes("/utils/") || path.includes("/hooks/")) return 1; if (path.includes("/components/")) return 2; if (path.includes("/pages/")) return 3; return 2; }
function createFallback(file) { const path = normalizePath(file.path); if (path.endsWith(".css")) return `/* ${file.description || "Generation failed"} */\n`; const safeName = path.split("/").pop()?.replace(/\.[^.]+$/, "") || "Placeholder"; const componentName = safeName.replace(/[^a-zA-Z0-9_$]/g, "") || "Placeholder"; return `import React from 'react';\n\nexport default function ${componentName}() {\n  return <div className='p-8 text-center text-zinc-400'>Component generation failed. Please retry.</div>;\n}\n`; }

async function generateSingleFile(file, allFiles, prompt, alreadyGeneratedFiles, ask, extraRepair = "") {
    let repairContext = extraRepair;
    for (let attempt = 0; attempt <= MAX_GENERATION_REPAIRS; attempt += 1) {
        const system = buildFileCodeSystem(allFiles, alreadyGeneratedFiles);
        const userMsg = [`Project: ${prompt}`, `Write the complete code for: ${file.path}`, `Purpose: ${file.description}`, repairContext].filter(Boolean).join("\n\n");
        const { object } = await ask({ model, schema: FileCodeSchema, system, prompt: userMsg });
        let code = normalizeContent(object.code);
        if (!code.trim()) throw new Error("Generated code is empty after normalization");
        if (Buffer.byteLength(code, "utf8") > PROJECT_LIMITS.maxFileBytes) throw new Error(`Generated file exceeds the ${PROJECT_LIMITS.maxFileBytes}-byte limit`);
        const validation = validateAndFixCode(code, file.path, { allPlannedFiles: allFiles });
        code = validation.code;
        const errors = inspectGeneratedCode(code, file.path, { allPlannedFiles: allFiles });
        if (!errors.length) return { path: file.path, code };
        if (attempt === MAX_GENERATION_REPAIRS) throw new Error(`Generated code failed validation: ${errors.join("; ")}`);
        repairContext = `REPAIR REQUIRED. Fix ONLY these issues and regenerate the COMPLETE file:\n- ${errors.join("\n- ")}`;
    }
    throw new Error("Generation repair loop exhausted");
}

async function repairProjectIntegrity(files, plan, prompt, callbacks, ask) {
    let report = analyzeProjectIntegrity(files);
    for (let round = 0; round < MAX_INTEGRITY_REPAIRS && !report.ok; round += 1) {
        const critical = getCriticalIntegrityErrors(report); if (!critical.length) break;
        const affected = new Set(); for (const item of report.syntaxErrors) affected.add(item.path); for (const item of report.unresolvedImports) affected.add(item.from);
        const repairFiles = plan.files.filter((file) => affected.has(normalizePath(file.path))).slice(0, 6); if (!repairFiles.length) break;
        await pMap(repairFiles, async (file) => { try { if (callbacks?.onFileStart) await callbacks.onFileStart(file.path); const errorsForFile = critical.filter((error) => error.startsWith(`${normalizePath(file.path)}:`)); const repair = `FINAL PROJECT INTEGRITY REPAIR. The project currently has these issues:\n- ${errorsForFile.join("\n- ")}\nRegenerate this COMPLETE file so its imports and syntax are compatible with the existing project files.`; const result = await generateSingleFile(file, plan.files, prompt, { ...files }, ask, repair); files[normalizePath(result.path)] = result.code; if (callbacks?.onFileComplete) await callbacks.onFileComplete(result.path, result.code); } catch (error) { if (error?.code === "AI_OPERATION_CALL_BUDGET_EXCEEDED" || error?.code === "AI_OPERATION_TIMEOUT" || error?.code === "AI_TOKEN_QUOTA_EXCEEDED" || error?.code === "AI_TOKEN_RESERVATION_EXCEEDED") throw error; console.warn(`[AI] Integrity repair failed for ${file.path}: ${error.message}`); } }, { concurrency: Math.min(MAX_CONCURRENCY, 3) });
        report = analyzeProjectIntegrity(files);
    }
    return report;
}

async function repairProjectBuild(files, plan, prompt, callbacks, ask) {
    let report = validateProjectBuild(files);
    for (let round = 0; round < MAX_BUILD_REPAIRS && report.status !== "passed"; round += 1) {
        const affectedPaths = new Set((report.errors || []).map((item) => item?.path).filter(Boolean).map(normalizePath));
        let repairFiles = plan.files.filter((file) => affectedPaths.has(normalizePath(file.path)));
        if (!repairFiles.length) repairFiles = plan.files.filter((file) => ["/App.js", "/App.jsx", "/main.js", "/main.jsx", "/index.js", "/index.jsx"].includes(normalizePath(file.path))).slice(0, 1);
        repairFiles = repairFiles.slice(0, 6); if (!repairFiles.length) break;
        const details = (report.errors || []).slice(0, 20).map((item) => `${item.path || "project"}: ${item.error || "Build validation failed"}`).join("\n- ");
        await pMap(repairFiles, async (file) => { try { if (callbacks?.onFileStart) await callbacks.onFileStart(file.path); const repair = `FINAL PROJECT BUILD REPAIR. Build validation failed with:\n- ${details}\nRegenerate this COMPLETE file. Fix the root cause only, preserve the intended UI and existing project architecture, and do not use placeholders or merge markers.`; const result = await generateSingleFile(file, plan.files, prompt, { ...files }, ask, repair); files[normalizePath(result.path)] = result.code; if (callbacks?.onFileComplete) await callbacks.onFileComplete(result.path, result.code); } catch (error) { if (error?.code === "AI_OPERATION_CALL_BUDGET_EXCEEDED" || error?.code === "AI_OPERATION_TIMEOUT" || error?.code === "AI_TOKEN_QUOTA_EXCEEDED" || error?.code === "AI_TOKEN_RESERVATION_EXCEEDED") throw error; console.warn(`[AI] Build repair failed for ${file.path}: ${error.message}`); } }, { concurrency: Math.min(MAX_CONCURRENCY, 2) });
        report = validateProjectBuild(files);
    }
    return report;
}

export async function generateProject(prompt, callbacks) {
    if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured");
    assertPromptSize(prompt);
    const budget = createOperationBudget({ timeoutMs: AI_OPERATION_LIMITS.generationTimeoutMs, label: "Project generation", userId: callbacks?.userId, operationId: callbacks?.operationId });
    const ask = createBudgetedProviderCall(generateObject, budget);
    await emitStage(callbacks, "planning");
    const { object: plan } = await ask({ model, schema: FilePlanSchema, system: FILE_PLAN_SYSTEM, prompt: `Plan a React website for: ${prompt}` });
    if (plan.files.length > PROJECT_LIMITS.maxFiles) throw Object.assign(new Error(`Generation plan exceeds the ${PROJECT_LIMITS.maxFiles}-file limit`), { status: 413, code: "PROJECT_FILE_COUNT_LIMIT" });
    if (!plan.files.find((file) => normalizePath(file.path) === "/App.js")) plan.files.unshift({ path: "/App.js", description: "Main application entry point", exports: "default App", imports: ["./styles.css"] });
    if (!plan.files.find((file) => normalizePath(file.path) === "/styles.css")) plan.files.push({ path: "/styles.css", description: "Global styles", exports: "none", imports: [] });
    if (plan.files.length > PROJECT_LIMITS.maxFiles) throw Object.assign(new Error(`Generation plan exceeds the ${PROJECT_LIMITS.maxFiles}-file limit`), { status: 413, code: "PROJECT_FILE_COUNT_LIMIT" });
    if (callbacks?.onPlan) await callbacks.onPlan(plan);
    await emitStage(callbacks, "generating");
    const files = {}, priorities = [...new Set(plan.files.map(getGenerationPriority))].sort((a, b) => a - b);
    for (const priority of priorities) {
        budget.assertActive();
        let pendingFiles = plan.files.filter((file) => getGenerationPriority(file) === priority);
        for (let round = 0; round <= 2 && pendingFiles.length; round += 1) {
            budget.assertActive();
            const results = await pMap(pendingFiles, async (file) => { try { if (callbacks?.onFileStart) await callbacks.onFileStart(file.path); const result = await generateSingleFile(file, plan.files, prompt, { ...files }, ask); if (callbacks?.onFileComplete) await callbacks.onFileComplete(file.path, result.code); return { success: true, file, result }; } catch (error) { if (["AI_OPERATION_CALL_BUDGET_EXCEEDED", "AI_OPERATION_TIMEOUT", "AI_TOKEN_QUOTA_EXCEEDED", "AI_TOKEN_RESERVATION_EXCEEDED"].includes(error?.code)) throw error; return { success: false, file, error }; } }, { concurrency: MAX_CONCURRENCY });
            pendingFiles = []; for (const entry of results) { if (entry.success) files[normalizePath(entry.result.path)] = entry.result.code; else pendingFiles.push(entry.file); }
        }
        for (const file of pendingFiles) { const path = normalizePath(file.path); files[path] = createFallback(file); if (callbacks?.onFileComplete) await callbacks.onFileComplete(path, files[path]); }
    }
    if (!files["/App.js"] && !files["/App.jsx"]) throw new Error("AI did not produce an application entry point");
    validateProjectFiles(files);
    await emitStage(callbacks, "validating_integrity");
    await repairProjectIntegrity(files, plan, prompt, callbacks, ask);
    await emitStage(callbacks, "validating_build");
    const build = await repairProjectBuild(files, plan, prompt, callbacks, ask);
    await emitStage(callbacks, "finalizing");
    validateProjectFiles(files);
    const finalIntegrity = analyzeProjectIntegrity(files);
    if (callbacks?.onValidation) await callbacks.onValidation({ type: "project-integrity", report: finalIntegrity });
    if (callbacks?.onValidation) await callbacks.onValidation({ type: "project-build", report: build });
    if (!finalIntegrity.ok || build.status !== "passed") { const errors = [...getCriticalIntegrityErrors(finalIntegrity), ...(build.errors || []).map((item) => `${item.path || "project"}: ${item.error || "Build validation failed"}`)]; throw new Error(`Generated project failed final validation: ${errors.slice(0, 10).join("; ")}`); }
    return { files, description: plan.projectDescription, dependencyReport: finalIntegrity.dependency, buildReport: build, operationBudget: budget.snapshot() };
}

export async function reviseProject(prompt, manifest, allFiles, recentMessages, options = {}) {
    assertPromptSize(prompt);
    validateProjectFiles(allFiles);
    const budget = createOperationBudget({ timeoutMs: AI_OPERATION_LIMITS.revisionTimeoutMs, label: "Project revision", userId: options.userId, operationId: options.operationId });
    const ask = createBudgetedProviderCall(generateObject, budget);
    const graphResult = buildDependencyGraph(allFiles), selection = selectRelevantFiles(prompt, manifest, allFiles, { maxFiles: MAX_REVISION_FILES, maxCharacters: MAX_REVISION_CONTEXT }), selectedPaths = Object.keys(selection.files), affectedPaths = getAffectedFiles(graphResult, selectedPaths, { includeDependencies: true, includeDependents: true }), contextPaths = [...new Set([...selectedPaths, ...affectedPaths])].filter((path) => allFiles[path]).slice(0, MAX_REVISION_FILES), contextFiles = Object.fromEntries(contextPaths.map((path) => [path, allFiles[path]]));
    const contextParts = ["## Current Project Files (manifest)", "```", ...manifest.map((file) => `${file.path} (${file.hash}, ${file.size}B)`), "```", "\n## Relevant and Dependency-Affected Files", ...Object.entries(contextFiles).map(([path, content]) => `\n### ${path}\n\`\`\`javascript\n${content}\n\`\`\``), `\n## Dependency Report\n${JSON.stringify(getDependencyReport(graphResult))}`];
    if (recentMessages?.length) { contextParts.push("\n## Recent Conversation"); for (const message of recentMessages.slice(-3)) contextParts.push(`${message.role}: ${message.content}`); }
    contextParts.push(`\n## Revision Request\n${prompt}`);
    const { object: rawParsed } = await ask({ model, schema: RevisionResultSchema, system: REVISE_SYSTEM, prompt: contextParts.join("\n") });
    if (rawParsed && Array.isArray(rawParsed.operations)) rawParsed.operations = rawParsed.operations.map((op) => { if (!op || typeof op !== "object") return op; const opName = String(op.op || "").trim().toLowerCase(); if (["create", "add", "new"].includes(opName)) op.op = "create"; else if (["update", "edit", "modify", "patch"].includes(opName)) op.op = "update"; else if (["delete", "remove", "del", "rm"].includes(opName)) op.op = "delete"; if (typeof op.path === "string") op.path = normalizePath(op.path); if (op.content) op.content = normalizeContent(op.content); if (op.search) op.search = normalizeContent(op.search); if (op.replace) op.replace = normalizeContent(op.replace); if (op.op === "create" && op.content) op.content = validateRevisionContent(op.content, op.path, "create").content; else if (op.op === "update" && op.replace) op.replace = validateRevisionContent(op.replace, op.path, "update").content; return op; });
    rawParsed.operationBudget = budget.snapshot();
    return rawParsed;
}