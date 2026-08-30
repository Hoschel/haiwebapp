import jwt from "jsonwebtoken";
import { requestContext } from "../services/requestContext.js";

function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) throw new Error("JWT_SECRET must be configured and contain at least 32 characters");
    return secret;
}

export function authMiddleware(req, res, next) {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ error: "Access denied. No session token provided." });
    try {
        req.user = jwt.verify(token, getJwtSecret());
        return requestContext.run({ userId: req.user.userId }, () => next());
    } catch (err) {
        if (err.message?.startsWith("JWT_SECRET must be configured")) return next(err);
        return res.status(401).json({ error: "Session expired or invalid. Please sign in again." });
    }
}
