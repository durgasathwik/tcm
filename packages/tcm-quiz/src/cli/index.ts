import type { Command } from "commander";
import { resolveConfig } from "../config.js";
import { runGenerate } from "../pipeline.js";
import { listJobs, readJob } from "../job-store.js";
import { loadNotebookMap, notebookMapPath, saveNotebookMap } from "../notebook-map.js";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface CliContext {
  config: Record<string, unknown> | undefined;
}

export function registerTcmQuizCli(program: Command, ctx: CliContext): void {
  let root = program.commands.find((c) => c.name() === "tcm");
  if (!root) {
    root = program.command("tcm").description("TCM study toolkit commands");
  }
  const quiz = root.command("quiz").description("Generate MCQ quizzes from study material");

  const cfg = () => resolveConfig(ctx.config);

  quiz
    .command("generate <source>")
    .description("Generate MCQs for a folder or file in the source bucket")
    .option("--count <n>", "Number of MCQs", (v) => parseInt(v, 10), 20)
    .option("--difficulty <level>", "easy | medium | hard", "medium")
    .action(async (source: string, opts: { count: number; difficulty: string }) => {
      const difficulty = (opts.difficulty as "easy" | "medium" | "hard") ?? "medium";
      if (!["easy", "medium", "hard"].includes(difficulty)) {
        process.stderr.write(`invalid difficulty: ${opts.difficulty}\n`);
        process.exit(1);
      }
      try {
        const result = await runGenerate({
          cfg: cfg(),
          source,
          count: opts.count,
          difficulty,
          onProgress: (ev) => {
            process.stdout.write(`[tcm-quiz] ${ev.type}: ${ev.message}\n`);
          },
        });
        process.stdout.write(JSON.stringify(result) + "\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[tcm-quiz] error: ${msg}\n`);
        process.exit(1);
      }
    });

  quiz
    .command("list")
    .description("List recent jobs")
    .option("--status <status>", "Filter by status (running|done|error)")
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10), 10)
    .action(async (opts: { status?: string; limit: number }) => {
      const c = cfg();
      const jobs = listJobs(c.resolvedDataDir)
        .filter((j) => (opts.status ? j.status === opts.status : true))
        .slice(0, opts.limit);
      if (jobs.length === 0) {
        process.stdout.write("(no jobs)\n");
        return;
      }
      for (const j of jobs) {
        process.stdout.write(
          `${j.id} · ${j.status.padEnd(7)} · ${j.sourceSpec} · ${j.count} q · ${j.startedAt}\n`
        );
      }
    });

  quiz
    .command("show <jobId>")
    .description("Print the full job record as JSON")
    .action(async (jobId: string) => {
      const c = cfg();
      const job = readJob(c.resolvedDataDir, jobId);
      if (!job) {
        process.stderr.write(`job not found: ${jobId}\n`);
        process.exit(1);
      }
      process.stdout.write(JSON.stringify(job, null, 2) + "\n");
    });

  quiz
    .command("download <jobId>")
    .description("Print a presigned download URL for the CSV of a completed job")
    .option("--ttl <seconds>", "URL TTL in seconds", (v) => parseInt(v, 10), 86400)
    .action(async (jobId: string, opts: { ttl: number }) => {
      const c = cfg();
      const job = readJob(c.resolvedDataDir, jobId);
      if (!job) {
        process.stderr.write(`job not found: ${jobId}\n`);
        process.exit(1);
      }
      if (!job.outputKey || !job.outputBucket) {
        process.stderr.write(`job ${jobId} has no output (status=${job.status})\n`);
        process.exit(1);
      }
      const endpoint = /^https?:\/\//.test(c.endpoint) ? c.endpoint : `https://${c.endpoint}`;
      const s3 = new S3Client({
        endpoint,
        region: c.region,
        credentials: { accessKeyId: c.accessKey, secretAccessKey: c.secretKey },
        forcePathStyle: true,
      });
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: job.outputBucket, Key: job.outputKey }),
        { expiresIn: opts.ttl }
      );
      process.stdout.write(url + "\n");
    });

  quiz
    .command("forget <topic>")
    .description("Clear the notebook-map entry for a topic so the next quiz uses a fresh notebook")
    .action(async (topic: string) => {
      const c = cfg();
      const path = notebookMapPath(c.resolvedDataDir);
      const map = loadNotebookMap(path);
      if (!map[topic]) {
        process.stdout.write(`no mapping for "${topic}"\n`);
        return;
      }
      delete map[topic];
      saveNotebookMap(path, map);
      process.stdout.write(`forgot "${topic}"\n`);
    });
}
