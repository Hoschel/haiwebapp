import { Project } from "../models/Project.js";
import { verifyProject, withRuntimeVerification } from "../services/projectVerification.js";

function serializeFiles(files) {
    return Object.fromEntries(Object.entries(files || {}).map(([path, entry]) => [path, typeof entry === "string" ? entry : entry?.content || ""]));
}

export async function getProjectVerification(req, res) {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const project = await Project.findOne({ _id: req.params.id, owner: req.user.userId });
    if (!project) return res.status(404).json({ error: "Project not found" });
    const verification = verifyProject(serializeFiles(project.files), project.verification?.runtime || {}, project.version);
    return res.json({ projectId: project._id, version: project.version, verification });
}

export async function reportRuntimeVerification(req, res) {
    const { status, error } = req.body || {};
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (!["passed", "failed"].includes(status)) return res.status(400).json({ error: "status must be passed or failed" });

    const project = await Project.findOne({ _id: req.params.id, owner: req.user.userId });
    if (!project) return res.status(404).json({ error: "Project not found" });

    const files = serializeFiles(project.files);
    project.verification = withRuntimeVerification(
        files,
        project.verification,
        { status, error: status === "failed" ? String(error || "Runtime verification failed") : null },
        project.version,
    );

    // Initial generation waits here until the preview verifies the exact project version.
    // Do not advance the stage for failed runtime checks: the repair pipeline may still recover.
    if (status === "passed" && project.verification.status === "verified" && project.generationStage === "awaiting_runtime") {
        project.generationStage = "completed";
        project.status = "completed";
        project.error = null;
    }

    project.markModified("verification");
    await project.save();

    return res.json({
        projectId: project._id,
        version: project.version,
        verification: project.verification,
        generationStage: project.generationStage,
        status: project.status,
    });
}
