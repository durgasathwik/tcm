import { z } from "zod";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { mergeEnvFromFile } from "@tcm/shared";

export const IdriveConfig = z.object({
  endpoint: z.string().url().default("https://s3.ap-northeast-1.idrivee2.com"),
  region: z.string().default("ap-northeast-1"),
  /**
   * Subject buckets — one bucket per subject (maths, biology, physics, etc).
   * Empty array means "auto-discover via ListBuckets" — useful when starting out,
   * but explicit listing is recommended for production.
   */
  subjectBuckets: z.array(z.string()).default([]),
  /** Buckets to exclude from auto-discovery (e.g. your MCQ output bucket). */
  excludeBuckets: z.array(z.string()).default([]),
  accessKeyEnv: z.string().default("IDRIVE_E2_ACCESS_KEY"),
  secretKeyEnv: z.string().default("IDRIVE_E2_SECRET_KEY"),
  dataDir: z.string().default("~/.tcm"),
  memoryDir: z.string().default(""),
});
export type IdriveConfig = z.infer<typeof IdriveConfig>;

export type ResolvedIdriveConfig = IdriveConfig & {
  resolvedDataDir: string;
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
): ResolvedIdriveConfig {
  const cfg = IdriveConfig.parse(raw ?? {});
  // Fall back to <dataDir>/.env so users don't have to `source` the file
  // before starting OpenClaw — process env still wins if both are set.
  const merged = mergeEnvFromFile(cfg.dataDir, env);
  const accessKey = merged[cfg.accessKeyEnv];
  const secretKey = merged[cfg.secretKeyEnv];
  if (!accessKey || !secretKey) {
    throw new Error(
      `tcm-idrive: missing credentials. Set ${cfg.accessKeyEnv} and ${cfg.secretKeyEnv} in env, or run \`openclaw tcm setup\` to write ${expandPath(cfg.dataDir)}/.env.`
    );
  }
  return {
    ...cfg,
    resolvedDataDir: expandPath(cfg.dataDir),
    accessKey,
    secretKey,
  };
}

/** Parse "bucket" or "bucket/key/or/prefix" → { bucket, key }. */
export function parseSourceSpec(spec: string): { bucket: string; key: string } {
  const slash = spec.indexOf("/");
  if (slash === -1) return { bucket: spec, key: "" };
  return { bucket: spec.slice(0, slash), key: spec.slice(slash + 1) };
}
