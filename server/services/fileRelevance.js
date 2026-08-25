const STOP_WORDS = new Set([
    "the", "and", "for", "with", "from", "that", "this", "into", "make", "add", "change", "update",
    "the", "bir", "ve", "ile", "için", "olan", "olarak", "bir", "bu", "şu", "ekle", "değiştir", "yap",
]);

function tokens(value) {
    return new Set(
        String(value || "")
            .toLowerCase()
            .replace(/[^a-z0-9çğıöşü_/-]+/gi, " ")
            .split(/\s+/)
            .map((token) => token.replace(/^\/+|\/+$/g, ""))
            .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)),
    );
}

function pathTokens(path) {
    return tokens(path.replace(/\.(jsx?|tsx?|css|json)$/i, "").replace(/[\/_.-]/g, " "));
}

function scoreFile(path, content, prompt, manifestEntry) {
    const promptTokens = tokens(prompt);
    const fileTokens = new Set([...pathTokens(path), ...tokens(manifestEntry?.description)]);
    const contentTokens = tokens(content);
    let score = 0;

    for (const token of promptTokens) {
        if (fileTokens.has(token)) score += 8;
        else if (contentTokens.has(token)) score += 2;
    }

    const lowerPrompt = String(prompt || "").toLowerCase();
    const lowerPath = path.toLowerCase();
    if (/navbar|header|navigation|menü|menu/.test(lowerPrompt) && /(nav|header)/.test(lowerPath)) score += 15;
    if (/hero|landing|ana sayfa|homepage/.test(lowerPrompt) && /(hero|app|home)/.test(lowerPath)) score += 12;
    if (/footer/.test(lowerPrompt) && lowerPath.includes("footer")) score += 15;
    if (/style|css|renk|color|tema|theme/.test(lowerPrompt) && lowerPath.endsWith(".css")) score += 10;
    if (/form|login|register|auth|giriş|kayıt/.test(lowerPrompt) && /(form|login|register|auth)/.test(lowerPath)) score += 12;

    if (lowerPath === "/app.js" || lowerPath === "/app.jsx") score += 4;
    if (lowerPath.endsWith("styles.css")) score += 2;

    return score;
}

export function selectRelevantFiles(prompt, manifest, files, options = {}) {
    const maxFiles = Math.max(1, Math.min(options.maxFiles || 12, 30));
    const maxCharacters = Math.max(4000, options.maxCharacters || 50000);
    const entries = Object.entries(files || {});

    const ranked = entries
        .map(([path, content]) => {
            const manifestEntry = manifest.find((entry) => entry.path === path);
            return { path, content: String(content || ""), score: scoreFile(path, content, prompt, manifestEntry) };
        })
        .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

    const selected = {};
    let characters = 0;

    for (const entry of ranked) {
        const isEntryPoint = ["/app.js", "/app.jsx"].includes(entry.path.toLowerCase());
        const isHighConfidence = entry.score > 0;
        if (!isEntryPoint && !isHighConfidence && Object.keys(selected).length >= Math.min(3, maxFiles)) continue;
        if (Object.keys(selected).length >= maxFiles) break;

        const remaining = maxCharacters - characters;
        if (remaining <= 0) break;

        const content = entry.content.length > remaining
            ? `${entry.content.slice(0, Math.max(0, remaining - 80))}\n/* context truncated */`
            : entry.content;

        selected[entry.path] = content;
        characters += content.length;
    }

    return {
        files: selected,
        ranked: ranked.slice(0, maxFiles).map(({ path, score }) => ({ path, score })),
        characterCount: characters,
    };
}
