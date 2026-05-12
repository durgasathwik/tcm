import type { Command } from "commander";
import { resolveConfig } from "../config.js";
import { SqliteStore, defaultDbPath } from "../sqlite-store.js";
import { buildClient } from "../s3-client.js";
import { runSync } from "./sync.js";
import { runLs } from "./ls.js";
import { runTree } from "./tree.js";
import { runFind } from "./find.js";
import { runGet } from "./get.js";
import { runPresign } from "./presign.js";
import { runSetup } from "./setup.js";

export interface CliContext {
  config: Record<string, unknown> | undefined;
}

export function registerTcmIdriveCli(program: Command, ctx: CliContext): void {
  let root = program.commands.find((c) => c.name() === "tcm");
  if (!root) {
    root = program.command("tcm").description("TCM study toolkit commands").helpOption(true);
  }

  // openclaw tcm setup — interactive by default; non-interactive with --yes.
  // Doesn't need open() because it captures credentials directly.
  root
    .command("setup")
    .description(
      "Interactive setup, or non-interactive when --yes + required flags are given (useful from chat agents shelling out to the CLI)"
    )
    .option("-y, --yes", "Non-interactive mode — require flags, do not prompt")
    .option("--endpoint <url>", "IDrive e2 endpoint URL")
    .option("--region <region>", "IDrive e2 region (signature)")
    .option("--access-key <key>", "IDrive access key")
    .option("--secret-key <key>", "IDrive secret key")
    .option(
      "--subject-buckets <csv>",
      "Comma-separated subject buckets, or 'auto' to use all discovered except --output-bucket"
    )
    .option("--output-bucket <name>", "Bucket where generated MCQ CSVs land")
    .option("--nlm-bin <path>", "Path to the nlm CLI")
    .option("--data-dir <path>", "Local data directory (default ~/.tcm)")
    .option(
      "--apply-config",
      "Also run `openclaw config set` to persist the snippet (otherwise just printed)"
    )
    .option("--json", "Emit a single-line JSON receipt at the end (non-interactive only)")
    .action(async (opts) => {
      const code = await runSetup({
        yes: !!opts.yes,
        endpoint: opts.endpoint,
        region: opts.region,
        accessKey: opts.accessKey,
        secretKey: opts.secretKey,
        subjectBuckets: opts.subjectBuckets,
        outputBucket: opts.outputBucket,
        nlmBin: opts.nlmBin,
        dataDir: opts.dataDir,
        applyConfig: !!opts.applyConfig,
        json: !!opts.json,
      });
      if (code !== 0) process.exitCode = code;
    });

  const idrive = root
    .command("idrive")
    .description("IDrive e2 source bucket operations (sync, list, search)");

  const open = () => {
    const cfg = resolveConfig(ctx.config);
    const client = buildClient(cfg);
    const store = new SqliteStore(defaultDbPath(cfg.resolvedDataDir));
    return { cfg, client, store };
  };

  idrive
    .command("sync")
    .description("List subject buckets and update local index + memory summaries")
    .option(
      "-p, --prefix <bucket-or-path>",
      "Only sync this bucket or '<bucket>/<keyPrefix>'"
    )
    .option("--dry-run", "Report changes without writing")
    .action(async (opts) => {
      const { cfg, client, store } = open();
      try {
        await runSync({ cfg, client, store, prefix: opts.prefix, dryRun: !!opts.dryRun });
      } finally {
        store.close();
      }
    });

  idrive
    .command("ls [path]")
    .description(
      "List buckets (no path), or top folders ('<bucket>'), or folder contents ('<bucket>/<path>')"
    )
    .action(async (path: string | undefined) => {
      const { cfg, store } = open();
      try {
        runLs({ cfg, store, path: path ?? "" });
      } finally {
        store.close();
      }
    });

  idrive
    .command("tree [bucket]")
    .description("Print folder tree for all subject buckets, or for a single bucket")
    .option("--depth <n>", "Max depth to show", (v) => parseInt(v, 10), 3)
    .action(async (bucket: string | undefined, opts) => {
      const { cfg, store } = open();
      try {
        runTree({ cfg, store, depth: opts.depth, bucket });
      } finally {
        store.close();
      }
    });

  idrive
    .command("find <query>")
    .description("Fuzzy search filenames across all subject buckets")
    .option("--bucket <name>", "Restrict to a single bucket")
    .option("--limit <n>", "Max results", (v) => parseInt(v, 10), 20)
    .action(async (query: string, opts) => {
      const { cfg, store } = open();
      try {
        runFind({ cfg, store, query, limit: opts.limit, bucket: opts.bucket });
      } finally {
        store.close();
      }
    });

  idrive
    .command("get <spec>")
    .description("Download an object: spec format '<bucket>/<key>'")
    .requiredOption("--out <path>", "Local path to write")
    .action(async (spec: string, opts) => {
      const { cfg, client } = open();
      await runGet({ cfg, client, spec, out: opts.out });
    });

  idrive
    .command("presign <spec>")
    .description("Print a presigned URL: spec format '<bucket>/<key>'")
    .option("--ttl <seconds>", "URL TTL in seconds", (v) => parseInt(v, 10), 86400)
    .action(async (spec: string, opts) => {
      const { cfg, client } = open();
      await runPresign({ cfg, client, spec, ttl: opts.ttl });
    });
}
