import { Project } from "../models/Project.js";
import crypto from "crypto";
import { generateProject } from "../services/ai.js";

function hashContent(content) {
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function serializeFiles(files) {
    const result = {};
    for (const [path, entry] of files || []) {
        result[path] = entry.content;
    }
    return result;
}

function projectResponse(project) {
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
    };
}

export async function createProject(req, res) {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return res.status(400).json({ error: "prompt is required" });
    }

    if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const cleanPrompt = prompt.trim();
    const project = await Project.create({
        name: "Planning project...",
        description: cleanPrompt,
        files: {},
        messages: [
            { role: "user", content: cleanPrompt },
            { role: "assistant", content: "Planning project structure..." },
        ],
        owner: req.user.userId,
        status: "pending",
    });

    runBackgroundGeneration(project._id.toString(), cleanPrompt).catch((err) => {
        console.error(`[Background AI] Fatal generation error for project ${project._id}:`, err);
    });

    return res.status(201).json(projectResponse(project));
}

async function runBackgroundGeneration(projectId, prompt) {
    try {
        const result = await generateProject(prompt, {
            onPlan: async (plan) => {
                const fileList = plan.files.map((file) => `- \`${file.path}\`: ${file.description}`).join("\n");

                await Project.findByIdAndUpdate(projectId, {
                    $set: {
                        name: plan.projectName || "Generated Project",
                        status: "generating",
                        filesPlanned: plan.files,
                        error: null,
                    },
                    $push: {
                        messages: {
                            role: "assistant",
                            content: `Planned website structure:\n${fileList}`,
                            timestamp: new Date(),
                        },
                    },
                });
            },
            onFileStart: async (path) => {
                await Project.findByIdAndUpdate(projectId, {
                    $set: { currentFile: path },
                });
            },
            onFileComplete: async (path, code) => {
                const hash = hashContent(code);
                await Project.findByIdAndUpdate(projectId, {
                    $set: {
                        [`files.${path}`]: { content: code, hash },
                        currentFile: null,
                    },
                    $addToSet: { filesGenerated: path },
                    $push: {
                        messages: {
                            role: "assistant",
                            content: `Created file \"${path}\"`,
                            timestamp: new Date(),
                        },
                    },
                });
            },
        });

        const finalUpdate = {
            $set: {
                status: "completed",
                currentFile: null,
                error: null,
            },
            $inc: { version: 1 },
            $push: {
                messages: {
                    role: "assistant",
                    content: "Website generation complete! You can view and edit the files.",
                    timestamp: new Date(),
                },
            },
        };

        if (result.description) finalUpdate.$set.name = result.description;
        await Project.findByIdAndUpdate(projectId, finalUpdate);
    } catch (err) {
        console.error(`[Background AI] Fatal generation error for project ${projectId}:`, err);
        await Project.findByIdAndUpdate(projectId, {
            $set: {
                status: "failed",
                currentFile: null,
                error: err.message,
            },
            $push: {
                messages: {
                    role: "assistant",
                    content: `Generation failed: ${err.message}`,
                    timestamp: new Date(),
                },
            },
        });
    }
}

export async function listProjects(req, res) {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const projects = await Project.find(
        { owner: req.user.userId },
        { name: 1, description: 1, version: 1, status: 1, published: 1, createdAt: 1, updatedAt: 1 },
    ).sort({ updatedAt: -1 });

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

// PUT /api/projects/:id/files
// The client must send its current version to prevent silent overwrite conflicts.
export async function updateProjectFiles(req, res) {
    const { files, version } = req.body;

    if (!files || typeof files !== "object" || Array.isArray(files)) {
        return res.status(400).json({ error: "files object is required" });
    }

    if (!Number.isInteger(version) || version < 0) {
        return res.status(400).json({ error: "A valid project version is required" });
    }

    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const newFiles = {};
    for (const [path, content] of Object.entries(files)) {
        if (typeof content === "string" && path.startsWith("/")) {
            newFiles[path] = { content, hash: hashContent(content) };
        }
    }

    const project = await Project.findOneAndUpdate(
        { _id: req.params.id, owner: req.user.userId, version },
        { $set: { files: newFiles }, $inc: { version: 1 } },
        { new: true, runValidators: true },
    );

    if (!project) {
        const exists = await Project.exists({ _id: req.params.id, owner: req.user.userId });
        if (!exists) return res.status(404).json({ error: "Project not found" });
        return res.status(409).json({ error: "Project was updated elsewhere. Reload and try again." });
    }

    return res.json(projectResponse(project));
}

export async function publishProject(req, res) {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const project = await Project.findOneAndUpdate(
        { _id: req.params.id, owner: req.user.userId },
        { $set: { published: true } },
        { new: true },
    );

    if (!project) return res.status(404).json({ error: "Project not found" });

    return res.json({ success: true, published: project.published });
}

export async function getPublicProject(req, res) {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!project.published) return res.status(403).json({ error: "Project is not published yet" });

    return res.json({
        _id: project._id,
        name: project.name,
        description: project.description,
        files: serializeFiles(project.files),
        version: project.version,
    });
}
