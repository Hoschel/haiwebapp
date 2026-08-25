import { Project } from "../models/Project.js";
import crypto from "crypto";
import { generateProject } from "../services/ai.js";

function hashContent(content) {
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function serializeFiles(files) {
    const result = {};
    if (!files) return result;
    const entries = files instanceof Map ? files.entries() : Object.entries(files);
    for (const [path, entry] of entries) result[path] = typeof entry === "string" ? entry : entry?.content || "";
    return result;
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
        filesPlanned: project.filesPlanned,
        filesGenerated: project.filesGenerated,
        currentFile: project.currentFile,
        error: project.error,
        published: project.published,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        ...extra,
    };
}

function normalizePath(path) { return path.startsWith("/") ? path : `/${path}`; }

async function updateGeneratedFile(projectId, path, code, retries = 5) {
    for (let attempt = 0; attempt < retries; attempt += 1) {
        const project = await Project.findById(projectId);
        if (!project) throw new Error("Project no longer exists");
        if (["failed", "completed"].includes(project.status)) return;

        const normalizedPath = normalizePath(path);
        project.files.set(normalizedPath, { content: code, hash: hashContent(code) });
        project.filesGenerated = [...new Set([...(project.filesGenerated || []), normalizedPath])];
        project.messages.push({ role: "assistant", content: `Created file "${normalizedPath}"`, timestamp: new Date() });
        project.currentFile = null;

        try {
            await project.save();
            return;
        } catch (error) {
            if (error?.name !== "VersionError" || attempt === retries - 1) throw error;
        }
    }
}

export async function createProject(req, res) {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) return res.status(400).json({ error: "prompt is required" });
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const cleanPrompt = prompt.trim();
    const project = await Project.create({
        name: "Planning project...", description: cleanPrompt, files: new Map(),
        messages: [{ role: "user", content: cleanPrompt }, { role: "assistant", content: "Planning project structure..." }],
        owner: req.user.userId, status: "pending",
    });

    runBackgroundGeneration(project._id.toString(), cleanPrompt).catch((err) => console.error(`[Background AI] Fatal generation error for ${project._id}:`, err));
    return res.status(201).json(projectResponse(project));
}

async function runBackgroundGeneration(projectId, prompt) {
    try {
        const result = await generateProject(prompt, {
            onPlan: async (plan) => {
                const fileList = plan.files.map((file) => `- \`${file.path}\`: ${file.description}`).join("\n");
                await Project.findByIdAndUpdate(projectId, {
                    $set: { name: plan.projectName || "Generated Project", status: "generating", filesPlanned: plan.files, error: null },
                    $push: { messages: { role: "assistant", content: `Planned website structure:\n${fileList}`, timestamp: new Date() } },
                });
            },
            onFileStart: async (path) => Project.findByIdAndUpdate(projectId, { $set: { currentFile: normalizePath(path) } }),
            onFileComplete: async (path, code) => updateGeneratedFile(projectId, path, code),
        });

        await Project.findByIdAndUpdate(projectId, {
            $set: { status: "completed", currentFile: null, error: null, ...(result.description ? { name: result.description } : {}) },
            $inc: { version: 1 },
            $push: { messages: { role: "assistant", content: "Website generation complete! You can view and edit the files.", timestamp: new Date() } },
        });
    } catch (err) {
        console.error(`[Background AI] Fatal generation error for ${projectId}:`, err);
        await Project.findByIdAndUpdate(projectId, {
            $set: { status: "failed", currentFile: null, error: err.message || "Generation failed" },
            $push: { messages: { role: "assistant", content: `Generation failed: ${err.message || "Unknown error"}`, timestamp: new Date() } },
        });
    }
}

export async function listProjects(req, res) {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const projects = await Project.find({ owner: req.user.userId }, { name: 1, description: 1, version: 1, status: 1, published: 1, createdAt: 1, updatedAt: 1 }).sort({ updatedAt: -1 });
    return res.json(projects);
}

export async function getProject(req, res) {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const project = await Project.findOne({ _id: req.params.id, owner: req.user.userId });
    if (!project) return res.status(404).json({ error: "Project not found" });
    return res.json(projectResponse(project));
}

export async function deleteProject(req, res) {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const result = await Project.findOneAndDelete({ _id: req.params.id, owner: req.user.userId });
    if (!result) return res.status(404).json({ error: "Project not found" });
    return res.json({ success: true });
}

export async function updateProjectFiles(req, res) {
    const { files, version } = req.body;
    if (!files || typeof files !== "object" || Array.isArray(files)) return res.status(400).json({ error: "files object is required" });
    if (!Number.isInteger(version) || version < 0) return res.status(400).json({ error: "A valid project version is required" });
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const newFiles = new Map();
    for (const [path, content] of Object.entries(files)) {
        if (typeof content === "string" && path.startsWith("/")) newFiles.set(path, { content, hash: hashContent(content) });
    }

    const project = await Project.findOneAndUpdate(
        { _id: req.params.id, owner: req.user.userId, version },
        { $set: { files: newFiles }, $inc: { version: 1 } },
        { new: true, runValidators: true },
    );

    if (!project) {
        const exists = await Project.exists({ _id: req.params.id, owner: req.user.userId });
        if (!exists) return res.status(404).json({ error: "Project not found" });
        const latest = await Project.findOne({ _id: req.params.id, owner: req.user.userId });
        return res.status(409).json({ error: "Project was updated elsewhere. Reload before saving again.", project: latest ? projectResponse(latest) : undefined });
    }
    return res.json(projectResponse(project));
}

export async function publishProject(req, res) {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const project = await Project.findOneAndUpdate({ _id: req.params.id, owner: req.user.userId }, { $set: { published: true } }, { new: true });
    if (!project) return res.status(404).json({ error: "Project not found" });
    return res.json({ success: true, published: project.published });
}

export async function getPublicProject(req, res) {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!project.published) return res.status(403).json({ error: "Project is not published yet" });
    return res.json({ _id: project._id, name: project.name, description: project.description, files: serializeFiles(project.files), version: project.version });
}
