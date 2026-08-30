import { getTokenQuota } from "../services/tokenQuota.js";

export async function getMyTokenQuota(req, res) {
    if (!req.user?.userId) return res.status(401).json({ error: "Unauthorized" });
    const quota = await getTokenQuota(req.user.userId);
    return res.json({ quota });
}
