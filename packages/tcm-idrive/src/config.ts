import { z } from "zod";
import { homedir } from "node:os";
import { resolve } from "node:path";

export const IdriveConfig = z.object({
  endpoint: z.string().url(),
  region: z.string().default("us-east-1"),
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
  const accessKey = env[cfg.accessKeyEnv];
  const secretKey = env[cfg.secretKeyEnv];
  if (!accessKey || !secretKey) {
    throw new Error(
      `tcm-idrive: missing credentials. Set ${cfg.accessKeyEnv} and ${cfg.secretKeyEnv} in env.`
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
