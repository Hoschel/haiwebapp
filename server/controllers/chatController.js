import { Project } from "../models/Project.js";
import { reviseProject } from "../services/ai.js";

function hashContent(content) {
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

import crypto from "crypto";

function buildManifest(files) {
    const manifest = [];
    for (const [path, entry] of Object.entries(files || {})) {
        const content = typeof entry === "string" ? entry : entry?.content || "";
        manifest.push({ path, hash: entry?.hash || hashContent(content), size: content.length });
    }
    return manifest;
}

function serializeFiles(files) {
    const output = {};
    for (const [path, entry] of Object.entries(files || {})) output[path] = typeof entry === "string" ? entry : entry?.content || "";
    return output;
}

function normalizePath(path) {
    return path.startsWith("/") ? path : `/${path}`;
}

function projectResponse(project, extra = {}) {
    return {
        _id: project._id,
        name: project.name,
        description: project.description,
        files: serializeFiles(project.files),
        messages: project.messages,
        version: project.version,
        status: project.status,
        published: project.published,
        applied: extra.applied || [],
        errors: extra.errors || [],
        aiDescription: extra.aiDescription,
    };
}

// POST /api/projects/:id/chat
export async function chat(req, res) {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) return res.status(400).json({ error: "prompt is required" });
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const project = await Project.findOne({ _id: req.params.id, owner: req.user.userId });
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (["pending", "generating", "revising"].includes(project.status)) return res.status(409).json({ error: "Project is busy. Wait for the current operation to finish." });

    const expectedVersion = project.version;
    project.status = "revising";
    project.error = null;
    project.messages.push({ role: "user", content: prompt.trim(), timestamp: new Date() });
    await project.save();

    try {
        const manifest = buildManifest(project.files);
        const relevantFiles = serializeFiles(project.files);
        const recentMessages = project.messages.slice(-6).map((message) => ({ role: message.role, content: message.content }));

        const result = await reviseProject(prompt.trim(), manifest, relevantFiles, recentMessages);
        const operations = Array.isArray(result.operations) ? result.operations : [];
        const errors = [];
        const applied = [];

        // Reload before applying so the revision is based on the latest document.
        const current = await Project.findOne({ _id: project._id, owner: req.user.userId, version: expectedVersion });
        if (!current) return res.status(409).json({ error: "Project changed while the revision was being generated. Please retry." });

        for (const operation of operations) {
            const path = normalizePath(operation.path);
            const existing = current.files.get(path);

            try {
                if (operation.op === "create") {
                    if (existing) throw new Error("File already exists");
                    const content = operation.content || "";
                    current.files.set(path, { content, hash: hashContent(content) });
                    applied.push(path);
                } else if (operation.op === "delete") {
                    if (!existing) throw new Error("File does not exist");
                    current.files.delete(path);
                    applied.push(path);
                } else if (operation.op === "update") {
                    if (!existing) throw new Error("File does not exist");
                    if (operation.expectedHash && operation.expectedHash !== existing.hash) throw new Error("File changed since the AI revision context was generated");
                    const search = operation.search || "";
                    const matches = existing.content.split(search).length - 1;
                    if (!search || matches === 0) throw new Error("Search text was not found");
                    if (operation.expectedMatches != null && matches !== operation.expectedMatches) throw new Error(`Expected ${operation.expectedMatches} matches, found ${matches}`);
                    const content = existing.content.replace(search, operation.replace || "");
                    current.files.set(path, { content, hash: hashContent(content) });
                    applied.push(path);
                }
            } catch (error) {
                errors.push({ path, op: operation.op, error: error.message });
            }
        }

        current.version = expectedVersion + 1;
        current.status = "completed";
        current.error = errors.length ? `Revision completed with ${errors.length} failed operation(s)` : null;
        current.messages.push({
            role: "assistant",
            content: result.description || (errors.length ? "Revision completed with errors." : "Revision applied successfully."),
            timestamp: new Date(),
        });
        current.markModified("files");
        await current.save();

        return res.json(projectResponse(current, {
            applied,
            errors,
            aiDescription: result.description,
        }));
    } catch (error) {
        console.error(`[AI Revision Error] ${error.message}`);
        const failed = await Project.findById(project._id);
        if (failed) {
            failed.status = "failed";
            failed.error = error.message || "Failed to process revision request";
            await failed.save().catch(() => {});
        }
        return res.status(500).json({ error: error.message || "Failed to process revision request" });
    }
}
