/**
 * Setup core — pure logic shared between the interactive CLI wizard,
 * the non-interactive CLI (flags only), and the MCP tools that drive
 * setup from chat.
 *
 * No stdin/stdout I/O lives here; the callers handle prompts and
 * rendering. Errors are returned in result objects rather than thrown
 * so chat-facing callers don't have to wrap everything in try/catch.
 */
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

export interface SetupAnswers {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  subjectBuckets: string[];
  outputBucket: string;
  nlmBin: string;
  dataDir: string;
}

export interface ProbeInput {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
}

export interface ProbeResult {
  ok: boolean;
  discoveredBuckets: string[];
  error?: string;
}

export interface BucketCheck {
  bucket: string;
  ok: boolean;
  error?: string;
}

export interface NlmCheck {
  ok: boolean;
  email?: string;
  error?: string;
}

export interface SaveOptions {
  /** Override the `.env` destination (default `<dataDir>/.env`). */
  envPath?: string;
  /** If true, call `openclaw config set` to apply the snippet automatically. */
  applyConfig?: boolean;
  /** Override the `openclaw` binary path (default: `openclaw` on PATH). */
  openclawBin?: string;
}

export interface SaveResult {
  ok: boolean;
  envPath: string;
  configSnippet: object;
  configSnippetJson: string;
  bucketChecks: BucketCheck[];
  nlmCheck: NlmCheck;
  configApplied: boolean;
  configApplyError?: string;
  warnings: string[];
}

const ENDPOINT_DEFAULT = "https://s3.ap-northeast-1.idrivee2.com";

/** Expand a leading `~` to the user's homedir. */
export function expandPath(p: string): string {
  if (p.startsWith("~")) return join(homedir(), p.slice(2));
  return p;
}

function normalizeEndpoint(ep: string): string {
  return /^https?:\/\//.test(ep) ? ep : `https://${ep}`;
}

function buildS3(input: ProbeInput): S3Client {
  return new S3Client({
    endpoint: normalizeEndpoint(input.endpoint || ENDPOINT_DEFAULT),
    region: input.region || "us-east-1",
    credentials: {
      accessKeyId: input.accessKey,
      secretAccessKey: input.secretKey,
    },
    forcePathStyle: true,
  });
}

/**
 * Hit ListBuckets with the provided credentials to confirm they work and
 * return the discovered buckets. Pure: doesn't write anything to disk.
 */
export async function probeCredentials(input: ProbeInput): Promise<ProbeResult> {
  if (!input.accessKey || !input.secretKey) {
    return {
      ok: false,
      discoveredBuckets: [],
      error: "accessKey and secretKey are required",
    };
  }
  try {
    const client = buildS3(input);
    const out = await client.send(new ListBucketsCommand({}));
    const buckets = (out.Buckets ?? [])
      .map((b) => b.Name ?? "")
      .filter(Boolean);
    return { ok: true, discoveredBuckets: buckets };
  } catch (err) {
    return {
      ok: false,
      discoveredBuckets: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Verify a single subject bucket is reachable. Uses ListObjectsV2 with
 * MaxKeys=1 — IDrive doesn't always honor HeadBucket consistently.
 */
async function pingBucket(client: S3Client, bucket: string): Promise<BucketCheck> {
  try {
    await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
    return { bucket, ok: true };
  } catch (err) {
    return {
      bucket,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Read existing key=value pairs from an env file, if present. */
export function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = stripQuotes(m[2]);
  }
  return out;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

export function renderEnvFile(a: SetupAnswers): string {
  const ts = new Date().toISOString();
  return [
    `# TCM Study Bot — written by openclaw tcm setup at ${ts}`,
    `# Source this file before running OpenClaw, e.g.:`,
    `#   set -a; source ~/.tcm/.env; set +a`,
    ``,
    `IDRIVE_E2_ACCESS_KEY=${a.accessKey}`,
    `IDRIVE_E2_SECRET_KEY=${a.secretKey}`,
    `IDRIVE_E2_ENDPOINT=${a.endpoint}`,
    `IDRIVE_E2_REGION=${a.region}`,
    `TCM_SUBJECT_BUCKETS=${a.subjectBuckets.join(",")}`,
    `TCM_MCQ_BUCKET=${a.outputBucket}`,
    `TCM_NLM_BIN=${a.nlmBin}`,
    `TCM_DATA_DIR=${a.dataDir}`,
    ``,
  ].join("\n");
}

interface ConfigEntries {
  "tcm-idrive": {
    enabled: true;
    config: {
      endpoint: string;
      region: string;
      subjectBuckets: string[];
      excludeBuckets: string[];
      dataDir: string;
    };
  };
  "tcm-notebooklm": {
    enabled: true;
    config: { nlmBin: string };
  };
  "tcm-quiz": {
    enabled: true;
    config: {
      outputBucket: string;
      endpoint: string;
      region: string;
      subjectBuckets: string[];
      dataDir: string;
      nlmBin: string;
    };
  };
}

export function buildConfigEntries(a: SetupAnswers): ConfigEntries {
  return {
    "tcm-idrive": {
      enabled: true,
      config: {
        endpoint: a.endpoint,
        region: a.region,
        subjectBuckets: a.subjectBuckets,
        excludeBuckets: [a.outputBucket],
        dataDir: a.dataDir,
      },
    },
    "tcm-notebooklm": {
      enabled: true,
      config: { nlmBin: a.nlmBin },
    },
    "tcm-quiz": {
      enabled: true,
      config: {
        outputBucket: a.outputBucket,
        endpoint: a.endpoint,
        region: a.region,
        subjectBuckets: a.subjectBuckets,
        dataDir: a.dataDir,
        nlmBin: a.nlmBin,
      },
    },
  };
}

export function renderConfigSnippet(a: SetupAnswers): string {
  return JSON.stringify({ plugins: { entries: buildConfigEntries(a) } }, null, 2) + "\n";
}

interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCmd(bin: string, args: string[], timeoutMs = 20_000): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ code: -1, stdout: out, stderr: err + "\n[timed out]" });
    }, timeoutMs);
    child.stdout.on("data", (b: Buffer) => (out += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (err += b.toString("utf8")));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: out, stderr: err + "\n" + e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: out, stderr: err });
    });
  });
}

export async function checkNlm(binPath: string): Promise<NlmCheck> {
  const expanded = expandPath(binPath);
  if (!existsSync(expanded)) {
    return { ok: false, error: `binary not found at ${expanded}` };
  }
  const { code, stdout, stderr } = await runCmd(expanded, ["login", "--check"], 15_000);
  const text = stdout + " " + stderr;
  const m = text.match(/Authentication valid!?\s*([^\s]+@[^\s]+)?/i);
  if (code === 0 && m) return { ok: true, email: m[1] };
  if (code === 0) return { ok: true };
  return { ok: false, error: text.trim().slice(0, 200) || `exit ${code}` };
}

async function applyOpenclawConfig(
  bin: string,
  a: SetupAnswers
): Promise<{ ok: boolean; error?: string }> {
  const entries = buildConfigEntries(a);
  for (const [id, body] of Object.entries(entries)) {
    const path = `plugins.entries.${id}`;
    const value = JSON.stringify(body);
    const { code, stderr } = await runCmd(
      bin,
      ["config", "set", path, value, "--strict-json"],
      15_000
    );
    if (code !== 0) {
      return {
        ok: false,
        error: `openclaw config set ${path} failed (exit ${code}): ${stderr.trim().slice(0, 300)}`,
      };
    }
  }
  return { ok: true };
}

/**
 * Persist the setup: write the env file, optionally apply the openclaw
 * config, and verify subject buckets + nlm. Idempotent — safe to re-run.
 */
export async function saveSetup(
  answers: SetupAnswers,
  opts: SaveOptions = {}
): Promise<SaveResult> {
  const warnings: string[] = [];
  const envPath = opts.envPath ?? join(expandPath(answers.dataDir), ".env");

  // Write env file with mode 0600.
  const envBody = renderEnvFile(answers);
  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(envPath, envBody, "utf8");
  try {
    chmodSync(envPath, 0o600);
  } catch (err) {
    warnings.push(
      `could not chmod 0600 on ${envPath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Ping each subject bucket.
  const client = buildS3(answers);
  const bucketChecks: BucketCheck[] = [];
  for (const b of answers.subjectBuckets) {
    bucketChecks.push(await pingBucket(client, b));
  }

  // Check nlm.
  const nlmCheck = await checkNlm(answers.nlmBin);
  if (!nlmCheck.ok) {
    warnings.push(`nlm check failed: ${nlmCheck.error}`);
  }

  // Optionally apply openclaw config.
  let configApplied = false;
  let configApplyError: string | undefined;
  if (opts.applyConfig) {
    const r = await applyOpenclawConfig(opts.openclawBin ?? "openclaw", answers);
    configApplied = r.ok;
    if (!r.ok) configApplyError = r.error;
  }

  const configSnippetJson = renderConfigSnippet(answers);
  const configSnippet = JSON.parse(configSnippetJson);

  return {
    ok: bucketChecks.every((c) => c.ok),
    envPath,
    configSnippet,
    configSnippetJson,
    bucketChecks,
    nlmCheck,
    configApplied,
    configApplyError,
    warnings,
  };
}
