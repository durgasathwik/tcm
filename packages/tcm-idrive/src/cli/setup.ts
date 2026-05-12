import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

export interface SetupOpts {
  envPath?: string;
  configHint?: string;
}

interface Answers {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  sourceBucket: string;
  mcqBucket: string;
  nlmBin: string;
  dataDir: string;
}

const DEFAULTS = {
  endpoint: "https://s3.us-east-1.idrivee2.com",
  region: "us-east-1",
  sourceBucket: "tcm-study",
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
    // readline doesn't natively mask. Best-effort: warn, then read.
    process.stdout.write(`(${prompt} — input visible; clear scrollback after if sensitive)\n`);
    return (await rl.question(`${prompt}: `)).trim();
  }

  stdout.write(`\n=== TCM Study Bot — Interactive Setup ===\n`);
  stdout.write(`Press Enter to accept the [default] shown in brackets.\n\n`);

  const envPath = opts.envPath ?? join(expandPath(DEFAULTS.dataDir), ".env");

  // Preload existing values from .env if it exists.
  const existing = loadEnvFile(envPath);

  const answers: Answers = {
    endpoint: await ask("IDrive e2 endpoint URL", existing.IDRIVE_E2_ENDPOINT ?? DEFAULTS.endpoint),
    region: await ask("IDrive e2 region", existing.IDRIVE_E2_REGION ?? DEFAULTS.region),
    accessKey: await askSecret("IDrive e2 access key"),
    secretKey: await askSecret("IDrive e2 secret key"),
    sourceBucket: await ask(
      "Source (study files) bucket",
      existing.TCM_SOURCE_BUCKET ?? DEFAULTS.sourceBucket
    ),
    mcqBucket: await ask(
      "MCQ (output) bucket",
      existing.TCM_MCQ_BUCKET ?? DEFAULTS.mcqBucket
    ),
    nlmBin: await ask("nlm CLI path", existing.TCM_NLM_BIN ?? DEFAULTS.nlmBin),
    dataDir: await ask("Local data directory", existing.TCM_DATA_DIR ?? DEFAULTS.dataDir),
  };

  rl.close();

  // 1. Write env file (mode 0600).
  const envBody = renderEnvFile(answers);
  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(envPath, envBody, "utf8");
  try {
    chmodSync(envPath, 0o600);
  } catch {
    // ignore on platforms that don't support it
  }
  stdout.write(`\n✓ Wrote ${envPath} (mode 0600)\n`);

  // 2. Verify credentials by listing the source bucket.
  stdout.write(`Verifying IDrive credentials by listing s3://${answers.sourceBucket}/ ...\n`);
  try {
    await verifyS3(answers);
    stdout.write(`✓ Source bucket reachable.\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stdout.write(`✗ Could not list source bucket: ${msg}\n`);
    stdout.write(`  Setup wrote the .env anyway — fix credentials and re-run.\n`);
  }

  // 3. Check nlm CLI.
  stdout.write(`Checking nlm CLI at ${answers.nlmBin} ...\n`);
  const nlmStatus = await checkNlm(expandPath(answers.nlmBin));
  if (nlmStatus.ok) {
    stdout.write(`✓ nlm authenticated: ${nlmStatus.email ?? "(unknown email)"}\n`);
  } else {
    stdout.write(`✗ nlm check failed: ${nlmStatus.error}\n`);
    stdout.write(`  Install with: pip install --user notebooklm-mcp-cli\n`);
    stdout.write(`  Then: ${answers.nlmBin} login\n`);
  }

  // 4. Print the openclaw config snippet.
  stdout.write(`\n=== Paste this into your ~/.openclaw/config.json ===\n`);
  stdout.write(renderConfigSnippet(answers));
  stdout.write(`\n=== End config snippet ===\n\n`);

  stdout.write(`Next:\n`);
  stdout.write(`  1. source ${envPath}   # or add to your shell profile\n`);
  stdout.write(`  2. Apply the config snippet above to ~/.openclaw/config.json.\n`);
  stdout.write(`  3. Restart your OpenClaw gateway.\n`);
  stdout.write(`  4. Try: openclaw tcm idrive sync\n`);
}

function expandPath(p: string): string {
  if (p.startsWith("~")) return join(homedir(), p.slice(2));
  return p;
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
    `# Source this file before running OpenClaw, e.g. in your shell profile:`,
    `#   set -a; source ~/.tcm/.env; set +a`,
    ``,
    `IDRIVE_E2_ACCESS_KEY=${a.accessKey}`,
    `IDRIVE_E2_SECRET_KEY=${a.secretKey}`,
    `IDRIVE_E2_ENDPOINT=${a.endpoint}`,
    `IDRIVE_E2_REGION=${a.region}`,
    `TCM_SOURCE_BUCKET=${a.sourceBucket}`,
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
            sourceBucket: a.sourceBucket,
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
            sourceBucket: a.sourceBucket,
            dataDir: a.dataDir,
            nlmBin: a.nlmBin,
          },
        },
      },
    },
  };
  return JSON.stringify(cfg, null, 2) + "\n";
}

async function verifyS3(a: Answers): Promise<void> {
  const endpoint = /^https?:\/\//.test(a.endpoint) ? a.endpoint : `https://${a.endpoint}`;
  const client = new S3Client({
    endpoint,
    region: a.region,
    credentials: { accessKeyId: a.accessKey, secretAccessKey: a.secretKey },
    forcePathStyle: true,
  });
  await client.send(new ListObjectsV2Command({ Bucket: a.sourceBucket, MaxKeys: 1 }));
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
      if (code === 0 && m) {
        resolve({ ok: true, email: m[1] });
      } else if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: text.trim().slice(0, 200) || `exit ${code}` });
      }
    });
  });
}
