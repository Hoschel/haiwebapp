import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import pMap from "p-map";
import { FileCodeSchema, FilePlanSchema, RevisionResultSchema } from "./aiSchemas.js";
import { buildFileCodeSystem, FILE_PLAN_SYSTEM, REVISE_SYSTEM } from "./prompts.js";
import { normalizeContent } from "./contentNormalizer.js";
import { validateAndFixCode, validateRevisionContent } from "./codeValidator.js";
import { selectRelevantFiles } from "./fileRelevance.js";

const MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";
const MAX_CONCURRENCY = Math.max(1, parseInt(process.env.AI_MAX_CONCURRENCY || "4", 10) || 4);
const MAX_REVISION_FILES = Math.max(3, Math.min(parseInt(process.env.AI_REVISION_MAX_FILES || "12", 10) || 12, 30));
const MAX_REVISION_CONTEXT = Math.max(10000, Math.min(parseInt(process.env.AI_REVISION_MAX_CONTEXT || "50000", 10) || 50000, 100000));

const openrouter = createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
});

const model = openrouter(MODEL);

async function generateSingleFile(file, allFiles, prompt, alreadyGeneratedFiles) {
    const system = buildFileCodeSystem(allFiles, alreadyGeneratedFiles);
    const userMsg = `Project: ${prompt}\n\nWrite the complete code for: ${file.path}\nPurpose: ${file.description}`;

    console.log(`[AI] Creating file: ${file.path}...`);

    const { object } = await generateObject({
        model,
        schema: FileCodeSchema,
        system,
        prompt: userMsg,
        maxRetries: 2,
    });

    let code = normalizeContent(object.code);
    if (!code.trim()) throw new Error("Generated code is empty after normalization");

    const validation = validateAndFixCode(code, file.path, { allPlannedFiles: allFiles });
    code = validation.code;

    if (validation.warnings.length > 0) {
        console.log(`[Validator] Code adjustments for ${file.path}:\n  - ${validation.warnings.join("\n  - ")}`);
    }

    return { path: file.path, code };
}

function normalizePath(path) {
    return path.startsWith("/") ? path : `/${path}`;
}

function getGenerationPriority(file) {
    const path = file.path.toLowerCase();
    if (path === "/app.js" || path === "/app.jsx" || path === "/styles.css" || path.includes("package.json")) return 0;
    if (path.includes("/utils/") || path.includes("/hooks/")) return 1;
    if (path.includes("/components/")) return 2;
    if (path.includes("/pages/")) return 3;
    return 2;
}

function createFallback(file) {
    const path = normalizePath(file.path);
    const extension = path.split(".").pop()?.toLowerCase();
    if (extension === "css") return `/* ${file.description || "Generation failed"} */\n`;

    const safeName = path.split("/").pop()?.replace(/\.[^.]+$/, "") || "Placeholder";
    const componentName = safeName.replace(/[^a-zA-Z0-9_$]/g, "") || "Placeholder";
    return `import React from 'react';\n\n// This file could not be generated automatically.\nexport default function ${componentName}() {\n  return (\n    <div className='p-8 text-center text-zinc-400'>\n      <p>Component generation failed. Please retry.</p>\n    </div>\n  );\n}\n`;
}

export async function generateProject(prompt, callbacks) {
    if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured");

    const { object: plan } = await generateObject({
        model,
        schema: FilePlanSchema,
        system: FILE_PLAN_SYSTEM,
        prompt: `Plan a React website for: ${prompt}`,
        maxRetries: 2,
    });

    if (!plan.files.find((file) => normalizePath(file.path) === "/App.js")) {
        plan.files.unshift({ path: "/App.js", description: "Main application entry point", exports: "default App", imports: ["./styles.css"] });
    }
    if (!plan.files.find((file) => normalizePath(file.path) === "/styles.css")) {
        plan.files.push({ path: "/styles.css", description: "Global styles", exports: "none", imports: [] });
    }

    if (callbacks?.onPlan) await callbacks.onPlan(plan);

    const files = {};
    const maxRetryRounds = 2;
    const priorities = [...new Set(plan.files.map(getGenerationPriority))].sort((a, b) => a - b);

    for (const priority of priorities) {
        let pendingFiles = plan.files.filter((file) => getGenerationPriority(file) === priority);
        for (let round = 0; round <= maxRetryRounds && pendingFiles.length > 0; round += 1) {
            const results = await pMap(pendingFiles, async (file) => {
                try {
                    if (callbacks?.onFileStart) await callbacks.onFileStart(file.path);
                    const result = await generateSingleFile(file, plan.files, prompt, { ...files });
                    if (callbacks?.onFileComplete) await callbacks.onFileComplete(file.path, result.code);
                    return { success: true, file, result };
                } catch (error) {
                    return { success: false, file, error };
                }
            }, { concurrency: MAX_CONCURRENCY });

            pendingFiles = [];
            for (const entry of results) {
                if (entry.success) files[normalizePath(entry.result.path)] = entry.result.code;
                else {
                    console.warn(`[AI] File ${entry.file.path} failed in round ${round}: ${entry.error?.message || entry.error}`);
                    pendingFiles.push(entry.file);
                }
            }
        }

        for (const file of pendingFiles) {
            const path = normalizePath(file.path);
            files[path] = createFallback(file);
            if (callbacks?.onFileComplete) await callbacks.onFileComplete(path, files[path]);
        }
    }

    if (!files["/App.js"] && !files["/App.jsx"]) throw new Error("AI did not produce an application entry point");
    return { files, description: plan.projectDescription };
}

export async function reviseProject(prompt, manifest, allFiles, recentMessages) {
    const selection = selectRelevantFiles(prompt, manifest, allFiles, {
        maxFiles: MAX_REVISION_FILES,
        maxCharacters: MAX_REVISION_CONTEXT,
    });

    const contextParts = [
        "## Current Project Files (manifest)",
        "```",
        ...manifest.map((file) => `${file.path} (${file.hash}, ${file.size}B)`),
        "```",
        "\n## Relevant File Contents",
        ...Object.entries(selection.files).map(([path, content]) => `\n### ${path}\n\`\`\`javascript\n${content}\n\`\`\``),
        `\n## Context Selection\nOnly files relevant to the request were included. Selected ${Object.keys(selection.files).length} file(s), ${selection.characterCount} characters.`,
    ];

    if (recentMessages?.length > 0) {
        contextParts.push("\n## Recent Conversation");
        for (const message of recentMessages.slice(-3)) contextParts.push(`${message.role}: ${message.content}`);
    }
    contextParts.push(`\n## Revision Request\n${prompt}`);

    const { object: rawParsed } = await generateObject({
        model,
        schema: RevisionResultSchema,
        system: REVISE_SYSTEM,
        prompt: contextParts.join("\n"),
        maxRetries: 2,
    });

    if (rawParsed && Array.isArray(rawParsed.operations)) {
        rawParsed.operations = rawParsed.operations.map((op) => {
            if (!op || typeof op !== "object") return op;
            const opName = String(op.op || "").trim().toLowerCase();
            if (["create", "add", "new"].includes(opName)) op.op = "create";
            else if (["update", "edit", "modify", "patch"].includes(opName)) op.op = "update";
            else if (["delete", "remove", "del", "rm"].includes(opName)) op.op = "delete";

            if (typeof op.path === "string") op.path = normalizePath(op.path);
            if (op.content) op.content = normalizeContent(op.content);
            if (op.search) op.search = normalizeContent(op.search);
            if (op.replace) op.replace = normalizeContent(op.replace);

            if (op.op === "create" && op.content) op.content = validateRevisionContent(op.content, op.path, "create").content;
            else if (op.op === "update" && op.replace) op.replace = validateRevisionContent(op.replace, op.path, "update").content;
            return op;
        });
    }

    return rawParsed;
}
