import mongoose, { Schema } from "mongoose";

const MessageSchema = new Schema({
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true, trim: true },
    timestamp: { type: Date, default: Date.now },
}, { _id: false });

const PlannedFileSchema = new Schema({
    path: { type: String, required: true },
    description: { type: String, required: true },
    exports: { type: String, default: "" },
    imports: { type: [String], default: [] },
}, { _id: false });

const VerificationSchema = new Schema({
    status: { type: String, enum: ["pending_runtime", "verified", "failed"], default: "pending_runtime" },
    static: {
        status: { type: String, enum: ["passed", "failed"], default: "passed" },
        checkedAt: { type: Date, default: null },
        errors: { type: [String], default: [] },
        unresolvedImports: { type: [Schema.Types.Mixed], default: [] },
        syntaxErrors: { type: [Schema.Types.Mixed], default: [] },
    },
    build: {
        status: { type: String, enum: ["passed", "failed"], default: "passed" },
        entry: { type: String, default: null },
        errors: { type: [Schema.Types.Mixed], default: [] },
        warnings: { type: [Schema.Types.Mixed], default: [] },
    },
    runtime: {
        status: { type: String, enum: ["pending", "passed", "failed"], default: "pending" },
        checkedAt: { type: Date, default: null },
        error: { type: String, default: null },
        version: { type: Number, default: null, min: 0 },
    },
}, { _id: false });

const ProjectSchema = new Schema({
    name: { type: String, required: true, default: "Untitled Project", trim: true },
    description: { type: String, default: "" },
    files: { type: Schema.Types.Mixed, default: {} },
    messages: { type: [MessageSchema], default: [] },
    version: { type: Number, default: 0, min: 0 },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    published: { type: Boolean, default: false },
    status: { type: String, enum: ["pending", "generating", "revising", "completed", "failed"], default: "pending" },
    filesPlanned: { type: [PlannedFileSchema], default: [] },
    filesGenerated: { type: [String], default: [] },
    currentFile: { type: String, default: null },
    error: { type: String, default: null },
    verification: { type: VerificationSchema, default: () => ({}) },
}, {
    timestamps: true,
    optimisticConcurrency: true,
});

function resetRuntimeVerification(update) {
    const next = update.$set || (update.$set = {});
    next["verification.status"] = "pending_runtime";
    next["verification.runtime.status"] = "pending";
    next["verification.runtime.checkedAt"] = null;
    next["verification.runtime.error"] = null;
    next["verification.runtime.version"] = null;
}

ProjectSchema.pre("save", function invalidateRuntime(next) {
    if (this.isModified("files") || this.isModified("version")) {
        const runtimeVersion = this.verification?.runtime?.version;
        if (runtimeVersion !== this.version) {
            this.verification.status = "pending_runtime";
            this.verification.runtime.status = "pending";
            this.verification.runtime.checkedAt = null;
            this.verification.runtime.error = null;
            this.verification.runtime.version = null;
            this.markModified("verification");
        }
    }
    next();
});

ProjectSchema.pre(["findOneAndUpdate", "updateOne", "updateMany"], function invalidateRuntimeForAtomicUpdate(next) {
    const update = this.getUpdate() || {};
    const changesFiles = Boolean(update.$set?.files || update.files);
    const changesVersion = Boolean(update.$inc?.version || update.$set?.version || update.version);
    if (changesFiles || changesVersion) resetRuntimeVerification(update);
    this.setUpdate(update);
    next();
});

ProjectSchema.index({ owner: 1, updatedAt: -1 });

export const Project = mongoose.model("Project", ProjectSchema);
