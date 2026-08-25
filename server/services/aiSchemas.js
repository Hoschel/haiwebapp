import { z } from "zod";

export const GenerationResultSchema = z.object({
    files: z.record(z.string(), z.string()),
    description: z.string().default("Generated project"),
});

export const FileOpSchema = z.object({
    op: z.enum(["create", "update", "delete"]),
    path: z.string().min(1),
    content: z.string().nullable().optional(),
    search: z.string().nullable().optional(),
    replace: z.string().nullable().optional(),
    expectedHash: z.string().nullable().optional(),
    expectedMatches: z.number().int().min(1).nullable().optional(),
}).superRefine((operation, ctx) => {
    if (operation.op === "create" && typeof operation.content !== "string") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["content"], message: "create operations require content" });
    }
    if (operation.op === "update" && typeof operation.search !== "string") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["search"], message: "update operations require search" });
    }
    if (operation.op === "update" && operation.expectedMatches != null && operation.expectedMatches < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expectedMatches"], message: "expectedMatches must be at least 1" });
    }
});

export const RevisionResultSchema = z.object({
    operations: z.array(FileOpSchema).max(50),
    description: z.string().default("Applied revisions"),
});

export const FilePlanSchema = z.object({
    files: z.array(z.object({
        path: z.string().min(1),
        description: z.string(),
        exports: z.string().optional().default(""),
        imports: z.array(z.string()).optional().default([]),
    })).min(1).max(100),
    projectName: z.string().default("Generated Project"),
    projectDescription: z.string().default("A React project"),
});

export const FileCodeSchema = z.object({
    code: z.string().min(1),
});
