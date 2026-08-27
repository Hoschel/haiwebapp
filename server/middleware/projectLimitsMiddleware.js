import { Project } from "../models/Project.js";
import { assertPromptSize, validateProjectFiles } from "../services/projectLimits.js";

const normalizePath = (path) => (String(path || "").startsWith("/") ? String(path) : `/${path}`);
const serializeFiles = (files) => Object.fromEntries(Object.entries(files || {}).map(([path, entry]) => [path, typeof entry === "string" ? entry : entry?.content || ""]));

export function validatePromptRequest(req, res, next) {
    try {
        assertPromptSize(req.body?.prompt);
        next();
    } catch (error) {
        res.status(error.status || 413).json({ error: error.message, code: error.code });
    }
}

export function validateFilesRequest(req, res, next) {
    try {
        const { files } = req.body || {};
        if (!files || typeof files !== "object" || Array.isArray(files)) return res.status(400).json({ error: "files object is required" });
        for (const [path, content] of Object.entries(files)) {
            if (!String(path).startsWith("/")) return res.status(400).json({ error: `Invalid file path: ${path}` });
            if (typeof content !== "string") return res.status(400).json({ error: `File content must be a string: ${path}` });
        }
        validateProjectFiles(files);
        next();
    } catch (error) {
        res.status(error.status || 413).json({ error: error.message, code: error.code, path: error.path });
    }
}

export async function validatePatchRequest(req, res, next) {
    try {
        const { patches, version } = req.body || {};
        if (!Array.isArray(patches) || !patches.length || patches.length > 100) return res.status(400).json({ error: "patches must contain 1-100 file changes" });
        if (!Number.isInteger(version) || version < 0) return res.status(400).json({ error: "A valid project version is required" });
        const project = await Project.findOne({ _id: req.params.id, owner: req.user?.userId, version });
        if (!project) return next();
        const files = serializeFiles(project.files);
        for (const patch of patches) {
            if (!patch || typeof patch.path !== "string" || !["upsert", "delete"].includes(patch.op)) return res.status(400).json({ error: "Each patch needs path and op=upsert|delete" });
            const path = normalizePath(patch.path);
            if (!path.startsWith("/") || path === "/") return res.status(400).json({ error: `Invalid file path: ${patch.path}` });
            if (patch.op === "delete") delete files[path];
            else {
                if (typeof patch.content !== "string") return res.status(400).json({ error: `content is required for ${path}` });
                files[path] = patch.content;
            }
        }
        validateProjectFiles(files);
        next();
    } catch (error) {
        res.status(error.status || 413).json({ error: error.message, code: error.code, path: error.path });
    }
}
