import { z } from "zod";

export const FileRecord = z.object({
  bucket: z.string(),
  key: z.string(),
  size: z.number().int().nonnegative(),
  etag: z.string(),
  contentType: z.string().nullable(),
  lastModified: z.string(),
  indexedAt: z.string(),
});
export type FileRecord = z.infer<typeof FileRecord>;

export const FolderRecord = z.object({
  bucket: z.string(),
  path: z.string(),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
});
export type FolderRecord = z.infer<typeof FolderRecord>;

export const MCQ = z.object({
  question: z.string().min(1),
  options: z.object({
    A: z.string(),
    B: z.string(),
    C: z.string(),
    D: z.string(),
  }),
  correct: z.enum(["A", "B", "C", "D"]),
  explanation: z.string().default(""),
  sourceKey: z.string().optional(),
});
export type MCQ = z.infer<typeof MCQ>;

export const JobStatus = z.enum(["running", "done", "error"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const Job = z.object({
  id: z.string(),
  status: JobStatus,
  sourceSpec: z.string(),
  sourceKeys: z.array(z.string()),
  count: z.number().int().nonnegative().default(0),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  outputBucket: z.string().nullable().default(null),
  outputKey: z.string().nullable().default(null),
  notebookId: z.string().nullable().default(null),
  startedAt: z.string(),
  endedAt: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
});
export type Job = z.infer<typeof Job>;

export const NotebookMapEntry = z.object({
  topic: z.string(),
  notebookId: z.string(),
  sources: z.record(
    z.string(),
    z.object({
      etag: z.string(),
      addedAt: z.string(),
    })
  ),
  lastUsedAt: z.string(),
});
export type NotebookMapEntry = z.infer<typeof NotebookMapEntry>;

export const NotebookMap = z.record(z.string(), NotebookMapEntry);
export type NotebookMap = z.infer<typeof NotebookMap>;

export const MCQGenerateRequest = z.object({
  source: z.string().min(1),
  count: z.number().int().positive().max(50).default(20),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  outputBucket: z.string().optional(),
});
export type MCQGenerateRequest = z.infer<typeof MCQGenerateRequest>;

export const MCQGenerateResult = z.object({
  jobId: z.string(),
  s3Uri: z.string(),
  presignedUrl: z.string(),
  count: z.number().int().nonnegative(),
  notebookId: z.string(),
});
export type MCQGenerateResult = z.infer<typeof MCQGenerateResult>;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function newJobId(): string {
  const r = Math.random().toString(36).slice(2, 8);
  return `j-${r}`;
}
