import mongoose, { Schema } from "mongoose";

const ReservationSchema = new Schema({
    operationId: { type: String, required: true },
    reservedTokens: { type: Number, required: true, min: 0 },
    createdAt: { type: Date, required: true, default: Date.now },
}, { _id: false });

const TokenAccountSchema = new Schema({
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    dailyFreeLimit: { type: Number, required: true, default: 1_000_000 },
    freeRemaining: { type: Number, required: true, default: 1_000_000, min: 0 },
    freeResetAt: { type: Date, required: true },
    paidBalance: { type: Number, required: true, default: 0, min: 0 },
    reservedTokens: { type: Number, required: true, default: 0, min: 0 },
    activeReservations: { type: [ReservationSchema], default: [] },
}, { timestamps: true });

export const TokenAccount = mongoose.model("TokenAccount", TokenAccountSchema);
