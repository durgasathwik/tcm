import { z } from "zod";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { mergeEnvFromFile } from "@tcm/shared";

export const QuizConfig = z.object({
  outputBucket: z.string().min(1).default("tcm-mcqs"),
  endpoint: z.string().url().default("https://s3.ap-northeast-1.idrivee2.com"),
  region: z.string().default("ap-northeast-1"),
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
  // Fall back to <dataDir>/.env so users don't have to `source` the file
  // before starting OpenClaw — process env still wins if both are set.
  const merged = mergeEnvFromFile(cfg.dataDir, env);
  const accessKey = merged[cfg.accessKeyEnv];
  const secretKey = merged[cfg.secretKeyEnv];
  if (!accessKey || !secretKey) {
    throw new Error(
      `tcm-quiz: missing credentials. Set ${cfg.accessKeyEnv} and ${cfg.secretKeyEnv} in env, or run \`openclaw tcm setup\` to write ${expandPath(cfg.dataDir)}/.env.`
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
