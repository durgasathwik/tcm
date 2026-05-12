import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { join } from "node:path";
import {
  expandPath,
  loadEnvFile,
  probeCredentials,
  saveSetup,
  type SetupAnswers,
} from "../setup-core.js";

export interface SetupOpts {
  /** Non-interactive flags. If `yes` is true and required fields are present, no prompts are issued. */
  yes?: boolean;
  endpoint?: string;
  region?: string;
  accessKey?: string;
  secretKey?: string;
  /** Comma-separated, or `auto` to take all discovered buckets except the output. */
  subjectBuckets?: string;
  outputBucket?: string;
  nlmBin?: string;
  dataDir?: string;
  /** Path override for the `.env` destination (mostly for tests). */
  envPath?: string;
  /** If true, call `openclaw config set ...` to persist the snippet. */
  applyConfig?: boolean;
  /** Override the `openclaw` binary path (mostly for tests). */
  openclawBin?: string;
  /** Emit a single-line JSON receipt at the end (handy for callers parsing output). */
  json?: boolean;
}

const DEFAULTS = {
  endpoint: "https://s3.ap-northeast-1.idrivee2.com",
  region: "ap-northeast-1",
  outputBucket: "tcm-mcqs",
  nlmBin: "~/.local/bin/nlm",
  dataDir: "~/.tcm",
};

export async function runSetup(opts: SetupOpts = {}): Promise<number> {
  const dataDir = opts.dataDir ?? DEFAULTS.dataDir;
  const envPath = opts.envPath ?? join(expandPath(dataDir), ".env");
  const existing = loadEnvFile(envPath);

  // Non-interactive: required fields must be present.
  if (opts.yes) {
    const missing: string[] = [];
    if (!opts.accessKey && !existing.IDRIVE_E2_ACCESS_KEY) missing.push("--access-key");
    if (!opts.secretKey && !existing.IDRIVE_E2_SECRET_KEY) missing.push("--secret-key");
    if (!opts.subjectBuckets) missing.push("--subject-buckets");
    if (missing.length > 0) {
      stdout.write(
        `setup --yes: missing required flags: ${missing.join(", ")}\n` +
          `(re-use existing creds from ${envPath} by omitting --access-key / --secret-key)\n`
      );
      return 2;
    }
    const answers = buildAnswers(opts, existing);
    if (answers.subjectBuckets[0] === "auto") {
      // resolve "auto" against ListBuckets, minus the output bucket
      const probe = await probeCredentials({
        endpoint: answers.endpoint,
        region: answers.region,
        accessKey: answers.accessKey,
        secretKey: answers.secretKey,
      });
      if (!probe.ok) {
        stdout.write(`setup --yes: could not auto-discover buckets: ${probe.error}\n`);
        return 3;
      }
      answers.subjectBuckets = probe.discoveredBuckets.filter(
        (b) => b !== answers.outputBucket
      );
    }
    const result = await saveSetup(answers, {
      envPath: opts.envPath,
      applyConfig: opts.applyConfig,
      openclawBin: opts.openclawBin,
    });
    if (opts.json) {
      stdout.write(
        JSON.stringify({
          envPath: result.envPath,
          subjectBuckets: answers.subjectBuckets,
          outputBucket: answers.outputBucket,
          bucketChecks: result.bucketChecks,
          nlmOk: result.nlmCheck.ok,
          nlmEmail: result.nlmCheck.email,
          configApplied: result.configApplied,
          configApplyError: result.configApplyError,
          warnings: result.warnings,
        }) + "\n"
      );
    } else {
      stdout.write(`\n=== TCM setup (non-interactive) ===\n`);
      stdout.write(`✓ wrote ${result.envPath} (mode 0600)\n`);
      for (const c of result.bucketChecks) {
        stdout.write(`  ${c.ok ? "✓" : "✗"} ${c.bucket}${c.error ? ` (${c.error})` : ""}\n`);
      }
      stdout.write(
        result.nlmCheck.ok
          ? `✓ nlm authenticated${result.nlmCheck.email ? ` as ${result.nlmCheck.email}` : ""}\n`
          : `✗ nlm: ${result.nlmCheck.error}\n`
      );
      if (opts.applyConfig) {
        stdout.write(
          result.configApplied
            ? `✓ applied openclaw config\n`
            : `✗ openclaw config apply: ${result.configApplyError}\n`
        );
      } else {
        stdout.write(
          `\nConfig snippet (rerun with --apply-config to apply automatically):\n` +
            result.configSnippetJson
        );
      }
    }
    return result.ok && (!opts.applyConfig || result.configApplied) ? 0 : 1;
  }

  // Interactive: original wizard, now backed by setup-core.
  const rl = createInterface({ input: stdin, output: stdout });
  function ask(prompt: string, defaultValue?: string): Promise<string> {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    return rl
      .question(`${prompt}${suffix}: `)
      .then((v) => (v.trim() === "" && defaultValue !== undefined ? defaultValue : v.trim()));
  }
  async function askSecret(prompt: string): Promise<string> {
    stdout.write(`(${prompt} — input visible; clear scrollback if sensitive)\n`);
    return (await rl.question(`${prompt}: `)).trim();
  }

  stdout.write(`\n=== TCM Study Bot — Interactive Setup ===\n`);
  stdout.write(`Press Enter to accept the [default] shown in brackets.\n\n`);

  const endpoint = await ask(
    "IDrive e2 endpoint URL",
    opts.endpoint ?? existing.IDRIVE_E2_ENDPOINT ?? DEFAULTS.endpoint
  );
  const region = await ask(
    "IDrive e2 region",
    opts.region ?? existing.IDRIVE_E2_REGION ?? DEFAULTS.region
  );
  const accessKey = opts.accessKey ?? (await askSecret("IDrive e2 access key"));
  const secretKey = opts.secretKey ?? (await askSecret("IDrive e2 secret key"));

  stdout.write(`\nDiscovering buckets in ${region}...\n`);
  const probe = await probeCredentials({ endpoint, region, accessKey, secretKey });
  if (probe.ok) {
    stdout.write(`Found ${probe.discoveredBuckets.length} bucket(s):\n`);
    probe.discoveredBuckets.forEach((b, i) => stdout.write(`  ${i + 1}. ${b}\n`));
  } else {
    stdout.write(`✗ Could not list buckets: ${probe.error}\n`);
    stdout.write(`  Continuing; you'll enter names manually.\n`);
  }

  const outputBucket = await ask(
    "MCQ output bucket (where generated CSVs go)",
    opts.outputBucket ?? existing.TCM_MCQ_BUCKET ?? DEFAULTS.outputBucket
  );

  let subjectBuckets: string[] = [];
  if (probe.discoveredBuckets.length > 0) {
    const candidate = probe.discoveredBuckets.filter((b) => b !== outputBucket);
    const answer = await ask(
      `Subject buckets (comma-separated, or 'auto' to use all discovered except output)`,
      candidate.join(",")
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

  const nlmBin = await ask("nlm CLI path", opts.nlmBin ?? existing.TCM_NLM_BIN ?? DEFAULTS.nlmBin);
  const dataDirAnswer = await ask(
    "Local data directory",
    opts.dataDir ?? existing.TCM_DATA_DIR ?? DEFAULTS.dataDir
  );
  rl.close();

  const answers: SetupAnswers = {
    endpoint,
    region,
    accessKey,
    secretKey,
    subjectBuckets,
    outputBucket,
    nlmBin,
    dataDir: dataDirAnswer,
  };

  const result = await saveSetup(answers, {
    envPath: opts.envPath,
    applyConfig: opts.applyConfig,
    openclawBin: opts.openclawBin,
  });

  stdout.write(`\n✓ Wrote ${result.envPath} (mode 0600)\n`);
  if (subjectBuckets.length > 0) {
    stdout.write(`\nVerifying subject buckets...\n`);
    for (const c of result.bucketChecks) {
      stdout.write(`  ${c.ok ? "✓" : "✗"} ${c.bucket}${c.error ? ` (${c.error})` : ""}\n`);
    }
  }

  stdout.write(`\nChecking nlm CLI at ${nlmBin}...\n`);
  stdout.write(
    result.nlmCheck.ok
      ? `✓ nlm authenticated${result.nlmCheck.email ? ` as ${result.nlmCheck.email}` : ""}\n`
      : `✗ nlm check failed: ${result.nlmCheck.error}\n` +
          `  Install: pipx install notebooklm-mcp-cli   (then: ${nlmBin} login)\n`
  );

  if (opts.applyConfig) {
    stdout.write(
      result.configApplied
        ? `\n✓ applied openclaw config\n`
        : `\n✗ openclaw config apply: ${result.configApplyError}\n`
    );
  } else {
    stdout.write(`\n=== Paste this into your ~/.openclaw/config.json ===\n`);
    stdout.write(result.configSnippetJson);
    stdout.write(`=== End config snippet ===\n\n`);
  }

  stdout.write(`Next:\n`);
  stdout.write(`  1. set -a; source ${result.envPath}; set +a\n`);
  if (!opts.applyConfig) {
    stdout.write(`  2. Apply the config snippet above to ~/.openclaw/config.json\n`);
  }
  stdout.write(`  ${opts.applyConfig ? 2 : 3}. Restart your OpenClaw gateway\n`);
  stdout.write(`  ${opts.applyConfig ? 3 : 4}. openclaw tcm idrive sync\n`);
  stdout.write(
    `  ${opts.applyConfig ? 4 : 5}. openclaw tcm quiz generate biology --count 5 --difficulty easy\n`
  );

  return result.ok && (!opts.applyConfig || result.configApplied) ? 0 : 1;
}

function buildAnswers(opts: SetupOpts, existing: Record<string, string>): SetupAnswers {
  const subjectBuckets = (opts.subjectBuckets ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    endpoint: opts.endpoint ?? existing.IDRIVE_E2_ENDPOINT ?? DEFAULTS.endpoint,
    region: opts.region ?? existing.IDRIVE_E2_REGION ?? DEFAULTS.region,
    accessKey: opts.accessKey ?? existing.IDRIVE_E2_ACCESS_KEY ?? "",
    secretKey: opts.secretKey ?? existing.IDRIVE_E2_SECRET_KEY ?? "",
    subjectBuckets,
    outputBucket: opts.outputBucket ?? existing.TCM_MCQ_BUCKET ?? DEFAULTS.outputBucket,
    nlmBin: opts.nlmBin ?? existing.TCM_NLM_BIN ?? DEFAULTS.nlmBin,
    dataDir: opts.dataDir ?? existing.TCM_DATA_DIR ?? DEFAULTS.dataDir,
  };
}
