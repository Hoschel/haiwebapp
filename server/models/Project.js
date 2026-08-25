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

const FileEntrySchema = new Schema({
    content: { type: String, required: true },
    hash: { type: String, required: true },
}, { _id: false });

const ProjectSchema = new Schema({
    name: { type: String, required: true, default: "Untitled Project", trim: true },
    description: { type: String, default: "" },
    files: { type: Map, of: FileEntrySchema, default: {} },
    messages: { type: [MessageSchema], default: [] },
    version: { type: Number, default: 0, min: 0 },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    published: { type: Boolean, default: false },
    status: {
        type: String,
        enum: ["pending", "generating", "revising", "completed", "failed"],
        default: "pending",
    },
    filesPlanned: { type: [PlannedFileSchema], default: [] },
    filesGenerated: { type: [String], default: [] },
    currentFile: { type: String, default: null },
    error: { type: String, default: null },
}, {
    timestamps: true,
    optimisticConcurrency: true,
});

ProjectSchema.index({ owner: 1, updatedAt: -1 });

export const Project = mongoose.model("Project", ProjectSchema);
