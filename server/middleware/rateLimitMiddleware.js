const buckets = new Map();

const cleanup = () => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
    }
};

setInterval(cleanup, 60_000).unref?.();

export const rateLimit = ({ windowMs = 60_000, max = 60, keyGenerator = (req) => req.user?.userId || req.ip || "anonymous", message = "Too many requests. Please try again later." } = {}) => (req, res, next) => {
    const key = `${keyGenerator(req)}:${req.baseUrl}:${req.path}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(bucket.resetAt / 1000));
    if (bucket.count > max) {
        res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
        return res.status(429).json({ error: message });
    }
    next();
};
