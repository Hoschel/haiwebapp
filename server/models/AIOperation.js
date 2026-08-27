import mongoose, { Schema } from "mongoose";

const UsageSchema = new Schema({
    inputTokens: { type: Number, default: 0, min: 0 },
    outputTokens: { type: Number, default: 0, min: 0 },
    totalTokens: { type: Number, default: 0, min: 0 },
}, { _id: false });

const AIOperationSchema = new Schema({
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    project: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    operationId: { type: String, required: true, unique: true, index: true },
    type: { type: String, enum: ["generation", "revision"], required: true },
    model: { type: String, required: true },
    status: { type: String, enum: ["running", "completed", "failed"], default: "running", index: true },
    providerCalls: { type: Number, default: 0, min: 0 },
    maxProviderCalls: { type: Number, required: true, min: 1 },
    usage: { type: UsageSchema, default: () => ({}) },
    error: { type: String, default: null },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
}, { timestamps: true });

AIOperationSchema.index({ owner: 1, createdAt: -1 });
AIOperationSchema.index({ project: 1, createdAt: -1 });

export const AIOperation = mongoose.model("AIOperation", AIOperationSchema);
