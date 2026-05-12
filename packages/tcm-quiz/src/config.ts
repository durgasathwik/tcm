import { z } from "zod";
import { homedir } from "node:os";
import { resolve } from "node:path";

export const QuizConfig = z.object({
  outputBucket: z.string().min(1),
  endpoint: z.string().url(),
  region: z.string().default("us-east-1"),
  accessKeyEnv: z.string().default("IDRIVE_E2_ACCESS_KEY"),
  secretKeyEnv: z.string().default("IDRIVE_E2_SECRET_KEY"),
  /** Subject buckets we're allowed to pull source files from. Used for validation only. */
  subjectBuckets: z.array(z.string()).default([]),
  dataDir: z.string().default("~/.tcm"),
  nlmBin: z.string().default("~/.local/bin/nlm"),
  maxFilesPerJob: z.number().int().positive().default(5),
  presignTtlSeconds: z.number().int().positive().default(86400),
  csvSchema: z
    .array(z.string())
    .default(["question", "A", "B", "C", "D", "correct", "explanation", "source_key"]),
});
export type QuizConfig = z.infer<typeof QuizConfig>;

export type ResolvedQuizConfig = QuizConfig & {
  resolvedDataDir: string;
  resolvedNlmBin: string;
  accessKey: string;
  secretKey: string;
};

export function expandPath(p: string): string {
  if (p.startsWith("~")) return resolve(homedir(), p.slice(2));
  return resolve(p);
}

export function resolveConfig(
  raw: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv = process.env
): ResolvedQuizConfig {
  const cfg = QuizConfig.parse(raw ?? {});
  const accessKey = env[cfg.accessKeyEnv];
  const secretKey = env[cfg.secretKeyEnv];
  if (!accessKey || !secretKey) {
    throw new Error(
      `tcm-quiz: missing credentials. Set ${cfg.accessKeyEnv} and ${cfg.secretKeyEnv} in env.`
    );
  }
  return {
    ...cfg,
    resolvedDataDir: expandPath(cfg.dataDir),
    resolvedNlmBin: expandPath(cfg.nlmBin),
    accessKey,
    secretKey,
  };
}

/** Parse "<bucket>" or "<bucket>/<keyOrPrefix>" → { bucket, key }. */
export function parseSourceSpec(spec: string): { bucket: string; key: string } {
  const slash = spec.indexOf("/");
  if (slash === -1) return { bucket: spec, key: "" };
  return { bucket: spec.slice(0, slash), key: spec.slice(slash + 1) };
}
