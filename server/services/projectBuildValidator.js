import { inspectGeneratedCode } from "./codeValidator.js";

function normalize(files) {
  return Object.fromEntries(Object.entries(files || {}).map(([path, entry]) => [path.startsWith("/") ? path : `/${path}`, typeof entry === "string" ? entry : entry?.content || ""]));
}

const ENTRY_CANDIDATES = ["/index.jsx", "/index.js", "/main.jsx", "/main.js", "/App.jsx", "/App.js"];

export function validateProjectBuild(files) {
  const normalized = normalize(files);
  const paths = Object.keys(normalized);
  const errors = [];
  const warnings = [];
  const entry = ENTRY_CANDIDATES.find((path) => path in normalized);

  if (!paths.length) errors.push({ stage: "build", path: null, error: "Project contains no files" });
  if (!entry) errors.push({ stage: "build", path: null, error: "No supported application entry file was found" });

  for (const [path, content] of Object.entries(normalized)) {
    if (/\.(js|jsx)$/i.test(path)) {
      for (const error of inspectGeneratedCode(content, path, { allPlannedFiles: paths.map((value) => ({ path: value })) })) {
        errors.push({ stage: "syntax", path, error });
      }
    }
    if (content.includes("<<<<<<<") || content.includes("=======") || content.includes(">>>>>>>")) {
      errors.push({ stage: "build", path, error: "Unresolved merge markers detected" });
    }
  }

  if (entry && !/\.(jsx?|tsx?)$/i.test(entry)) warnings.push({ path: entry, warning: "Entry file is not JavaScript/JSX" });

  return {
    status: errors.length ? "failed" : "passed",
    checkedAt: new Date(),
    entry,
    errors,
    warnings,
  };
}
