import express from "express";
import "dotenv/config";
import cors from "cors";
import cookieParser from "cookie-parser";
import { connectToDatabase } from "./config/db.js";
import authRouter from "./routes/authRoutes.js";
import projectRouter from "./routes/projectRoutes.js";

const app = express();
const origins = (process.env.ORIGINS || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

await connectToDatabase();

app.use(cors({ origin: origins, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => res.send("Server is Live!"));
app.use("/api/auth", authRouter);
app.use("/api/projects", projectRouter);

app.use((err, _req, res, _next) => {
    console.error("[Error]", err);
    const message = process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message || "Internal server error";
    res.status(err.status || 500).json({ error: message });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
