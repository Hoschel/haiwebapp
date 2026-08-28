import express from "express";
import "dotenv/config";
import cors from "cors";
import cookieParser from "cookie-parser";
import { connectToDatabase } from "./config/db.js";
import authRouter from "./routes/authRoutes.js";
import projectRouter from "./routes/projectRoutes.js";
import { rateLimit } from "./middleware/rateLimitMiddleware.js";
import { recoverStaleAIOperations } from "./services/aiOperationRecovery.js";

const app = express();
const origins = (process.env.ORIGINS || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

await connectToDatabase();
await recoverStaleAIOperations();

app.disable("x-powered-by");
app.use(cors({ origin: origins, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "2mb", strict: true }));
app.use("/api/auth", rateLimit({ windowMs: 60_000, max: 30, keyGenerator: (req) => req.ip || "anonymous", message: "Too many authentication requests. Please try again later." }), authRouter);
app.use("/api/projects", rateLimit({ windowMs: 60_000, max: 120 }), projectRouter);

app.get("/", (_req, res) => res.send("Server is Live!"));

app.use((err, _req, res, _next) => {
    console.error("[Error]", err);
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    const message = process.env.NODE_ENV === "production"
        ? (status === 429 ? err.message : "Internal server error")
        : err.message || "Internal server error";
    res.status(status).json({ error: message });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});