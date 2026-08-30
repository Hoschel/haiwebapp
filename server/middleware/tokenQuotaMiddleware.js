import { getTokenQuota } from "../services/tokenQuota.js";

export async function requireAITokens(req, res, next) {
    if (!req.user?.userId) return res.status(401).json({ error: "Unauthorized" });
    try {
        const quota = await getTokenQuota(req.user.userId);
        if (quota.available <= 0) {
            return res.status(402).json({
                error: quota.paidBalance > 0
                    ? "No tokens are currently available for this AI request."
                    : "Daily free token limit reached. Wait for the reset time or purchase additional tokens to continue.",
                code: "AI_TOKEN_QUOTA_EXCEEDED",
                quota,
            });
        }
        req.aiTokenQuota = quota;
        return next();
    } catch (error) {
        return next(error);
    }
}
