import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { S3Client } from "@aws-sdk/client-s3";
import { listAllBuckets } from "../s3-client.js";

export interface SetupOpts {
  envPath?: string;
}

interface Answers {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  subjectBuckets: string[];
  mcqBucket: string;
  nlmBin: string;
  dataDir: string;
}

const DEFAULTS = {
  endpoint: "https://s3.ap-northeast-1.idrivee2.com",
  region: "ap-northeast-1",
  mcqBucket: "tcm-mcqs",
  nlmBin: "~/.local/bin/nlm",
  dataDir: "~/.tcm",
};

export async function runSetup(opts: SetupOpts = {}): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  function ask(prompt: string, defaultValue?: string): Promise<string> {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    return rl
      .question(`${prompt}${suffix}: `)
      .then((v) => (v.trim() === "" && defaultValue !== undefined ? defaultValue : v.trim()));
  }

  async function askSecret(prompt: string): Promise<string> {
    process.stdout.write(`(${prompt} — input visible; clear scrollback if sensitive)\n`);
    return (await rl.question(`${prompt}: `)).trim();
  }

  stdout.write(`\n=== TCM Study Bot — Interactive Setup ===\n`);
  stdout.write(`Press Enter to accept the [default] shown in brackets.\n\n`);

  const envPath = opts.envPath ?? join(expandPath(DEFAULTS.dataDir), ".env");
  const existing = loadEnvFile(envPath);

  const endpoint = await ask(
    "IDrive e2 endpoint URL",
    existing.IDRIVE_E2_ENDPOINT ?? DEFAULTS.endpoint
  );
  const region = await ask("IDrive e2 region", existing.IDRIVE_E2_REGION ?? DEFAULTS.region);
  const accessKey = await askSecret("IDrive e2 access key");
  const secretKey = await askSecret("IDrive e2 secret key");

  // Discover buckets right after creds so we can show the actual list.
  stdout.write(`\nDiscovering buckets in ${region}...\n`);
  let discoveredBuckets: string[] = [];
  try {
    const client = buildS3(endpoint, region, accessKey, secretKey);
    discoveredBuckets = await listAllBuckets(client);
    stdout.write(`Found ${discoveredBuckets.length} bucket(s):\n`);
    discoveredBuckets.forEach((b, i) => stdout.write(`  ${i + 1}. ${b}\n`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stdout.write(`✗ Could not list buckets: ${msg}\n`);
    stdout.write(`  Continuing with empty bucket discovery; you'll enter names manually.\n`);
  }

  const mcqBucket = await ask(
    "MCQ output bucket (where generated CSVs go)",
    existing.TCM_MCQ_BUCKET ?? DEFAULTS.mcqBucket
  );

  let subjectBuckets: string[] = [];
  if (discoveredBuckets.length > 0) {
    const candidate = discoveredBuckets.filter((b) => b !== mcqBucket);
    const csv = candidate.join(",");
    const answer = await ask(
      `Subject buckets (comma-separated, or 'auto' to use all discovered except output)`,
      csv
    );
    subjectBuckets =
      answer === "auto"
        ? candidate
        : answer
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
  } else {
    const answer = await ask(
      `Subject buckets (comma-separated, e.g. maths,biology,physics)`,
      existing.TCM_SUBJECT_BUCKETS ?? ""
    );
    subjectBuckets = answer
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const nlmBin = await ask("nlm CLI path", existing.TCM_NLM_BIN ?? DEFAULTS.nlmBin);
  const dataDir = await ask("Local data directory", existing.TCM_DATA_DIR ?? DEFAULTS.dataDir);

  rl.close();

  const answers: Answers = {
    endpoint,
    region,
    accessKey,
    secretKey,
    subjectBuckets,
    mcqBucket,
    nlmBin,
    dataDir,
  };

  // Write env file.
  const envBody = renderEnvFile(answers);
  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(envPath, envBody, "utf8");
  try {
    chmodSync(envPath, 0o600);
  } catch {
    // ignore
  }
  stdout.write(`\n✓ Wrote ${envPath} (mode 0600)\n`);

  // Verify each subject bucket is reachable (HeadBucket via ListObjectsV2 max 1).
  if (subjectBuckets.length > 0) {
    stdout.write(`\nVerifying subject buckets...\n`);
    const client = buildS3(endpoint, region, accessKey, secretKey);
    for (const b of subjectBuckets) {
      const ok = await pingBucket(client, b);
      stdout.write(`  ${ok ? "✓" : "✗"} ${b}\n`);
    }
  }

  // Check nlm CLI.
  stdout.write(`\nChecking nlm CLI at ${nlmBin}...\n`);
  const nlmStatus = await checkNlm(expandPath(nlmBin));
  if (nlmStatus.ok) {
    stdout.write(`✓ nlm authenticated${nlmStatus.email ? ` as ${nlmStatus.email}` : ""}\n`);
  } else {
    stdout.write(`✗ nlm check failed: ${nlmStatus.error}\n`);
    stdout.write(`  Install: pipx install notebooklm-mcp-cli   (then: ${nlmBin} login)\n`);
  }

  // Print config snippet.
  stdout.write(`\n=== Paste this into your ~/.openclaw/config.json ===\n`);
  stdout.write(renderConfigSnippet(answers));
  stdout.write(`=== End config snippet ===\n\n`);

  stdout.write(`Next:\n`);
  stdout.write(`  1. set -a; source ${envPath}; set +a   # or load via your service manager\n`);
  stdout.write(`  2. Apply the config snippet above to ~/.openclaw/config.json\n`);
  stdout.write(`  3. Restart your OpenClaw gateway\n`);
  stdout.write(`  4. openclaw tcm idrive sync\n`);
  stdout.write(`  5. openclaw tcm quiz generate biology --count 5 --difficulty easy\n`);
}

function expandPath(p: string): string {
  if (p.startsWith("~")) return join(homedir(), p.slice(2));
  return p;
}

function buildS3(endpoint: string, region: string, ak: string, sk: string): S3Client {
  const ep = /^https?:\/\//.test(endpoint) ? endpoint : `https://${endpoint}`;
  return new S3Client({
    endpoint: ep,
    region,
    credentials: { accessKeyId: ak, secretAccessKey: sk },
    forcePathStyle: true,
  });
}

async function pingBucket(client: S3Client, bucket: string): Promise<boolean> {
  try {
    const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
    return true;
  } catch {
    return false;
  }
}

function loadEnvFile(path: string): Record<string, string> {
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

function renderEnvFile(a: Answers): string {
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
    `TCM_MCQ_BUCKET=${a.mcqBucket}`,
    `TCM_NLM_BIN=${a.nlmBin}`,
    `TCM_DATA_DIR=${a.dataDir}`,
    ``,
  ].join("\n");
}

function renderConfigSnippet(a: Answers): string {
  const cfg = {
    plugins: {
      entries: {
        "tcm-idrive": {
          enabled: true,
          config: {
            endpoint: a.endpoint,
            region: a.region,
            subjectBuckets: a.subjectBuckets,
            excludeBuckets: [a.mcqBucket],
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
            outputBucket: a.mcqBucket,
            endpoint: a.endpoint,
            region: a.region,
            subjectBuckets: a.subjectBuckets,
            dataDir: a.dataDir,
            nlmBin: a.nlmBin,
          },
        },
      },
    },
  };
  return JSON.stringify(cfg, null, 2) + "\n";
}

interface NlmCheck {
  ok: boolean;
  email?: string;
  error?: string;
}

function checkNlm(binPath: string): Promise<NlmCheck> {
  return new Promise((resolve) => {
    if (!existsSync(binPath)) {
      resolve({ ok: false, error: `binary not found at ${binPath}` });
      return;
    }
    const child = spawn(binPath, ["login", "--check"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, error: "nlm check timed out" });
    }, 15_000);
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = stdout + " " + stderr;
      const m = text.match(/Authentication valid!?\s*([^\s]+@[^\s]+)?/i);
      if (code === 0 && m) resolve({ ok: true, email: m[1] });
      else if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: text.trim().slice(0, 200) || `exit ${code}` });
    });
  });
}
