import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createWriteStream, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { pipeline as streamPipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import {
  newJobId,
  slugify,
  type Job,
  type MCQ,
  type FileRecord,
  type NotebookMap,
} from "@tcm/shared";
import { parseMcqArray, dedupeMcqs } from "./mcq-parser.js";
import { writeCsv } from "./csv-writer.js";
import { writeJob } from "./job-store.js";
import {
  loadNotebookMap,
  saveNotebookMap,
  notebookMapPath,
  getEntry,
  upsertEntry,
  sourcesToAdd,
} from "./notebook-map.js";
import type { ResolvedQuizConfig } from "./config.js";

export interface ProgressEvent {
  type: "start" | "resolved" | "step" | "done" | "error";
  message: string;
  data?: Record<string, unknown>;
}

export type ProgressFn = (event: ProgressEvent) => void;

export interface GenerateInput {
  cfg: ResolvedQuizConfig;
  source: string;
  count: number;
  difficulty: "easy" | "medium" | "hard";
  onProgress: ProgressFn;
}

export interface GenerateOutput {
  jobId: string;
  s3Uri: string;
  presignedUrl: string;
  count: number;
  notebookId: string;
  outputKey: string;
}

export async function runGenerate(input: GenerateInput): Promise<GenerateOutput> {
  const { cfg, source, count, difficulty, onProgress } = input;

  const jobId = newJobId();
  const startedAt = new Date().toISOString();
  const scratchDir = join("/tmp", "tcm", jobId);
  const indexDbPath = join(cfg.resolvedDataDir, "index.db");

  let job: Job = {
    id: jobId,
    status: "running",
    sourceSpec: source,
    sourceKeys: [],
    count: 0,
    difficulty,
    outputBucket: cfg.outputBucket,
    outputKey: null,
    notebookId: null,
    startedAt,
    endedAt: null,
    error: null,
  };
  writeJob(cfg.resolvedDataDir, job);
  onProgress({ type: "start", message: `job ${jobId} started`, data: { jobId } });

  try {
    // 1. Resolve source via shared SQLite index (read-only).
    const sourceFiles = resolveSourceFromIndex(indexDbPath, cfg.sourceBucket, source).slice(
      0,
      cfg.maxFilesPerJob
    );
    if (sourceFiles.length === 0) {
      throw new Error(`no files resolved for source "${source}". Run \`openclaw tcm idrive sync\` first.`);
    }
    job = { ...job, sourceKeys: sourceFiles.map((f) => f.key) };
    writeJob(cfg.resolvedDataDir, job);
    onProgress({
      type: "resolved",
      message: `resolved ${sourceFiles.length} file(s)`,
      data: { keys: job.sourceKeys },
    });

    // 2. Find or create notebook for this topic (notebook reuse).
    const mapPath = notebookMapPath(cfg.resolvedDataDir);
    let map: NotebookMap = loadNotebookMap(mapPath);
    const existing = getEntry(map, source);
    let notebookId: string;
    if (existing) {
      notebookId = existing.notebookId;
      onProgress({
        type: "step",
        message: `reusing notebook ${notebookId} for topic "${source}"`,
      });
    } else {
      const title = `TCM ${source} ${startedAt.slice(0, 10)}`;
      notebookId = await nlmCreateNotebook(cfg, title);
      onProgress({ type: "step", message: `created notebook ${notebookId}` });
    }
    job = { ...job, notebookId };
    writeJob(cfg.resolvedDataDir, job);

    // 3. Diff sources and download+add only what's new/changed.
    const desired = sourceFiles.map((f) => ({ key: f.key, etag: f.etag }));
    const toAdd = sourcesToAdd(existing, desired);
    if (toAdd.length === 0) {
      onProgress({ type: "step", message: "all sources already in notebook" });
    }
    mkdirSync(scratchDir, { recursive: true });
    const s3 = buildS3Client(cfg);
    for (let i = 0; i < toAdd.length; i++) {
      const src = toAdd[i];
      const dest = join(scratchDir, basename(src.key) || `source-${i}.bin`);
      onProgress({
        type: "step",
        message: `[${i + 1}/${toAdd.length}] downloading ${src.key}`,
      });
      await downloadToFile(s3, cfg.sourceBucket, src.key, dest);
      onProgress({
        type: "step",
        message: `[${i + 1}/${toAdd.length}] uploading to NotebookLM`,
      });
      await nlmAddSource(cfg, notebookId, dest);
    }
    map = upsertEntry(map, source, notebookId, toAdd);
    saveNotebookMap(mapPath, map);

    // 4. Query NotebookLM for MCQs.
    onProgress({ type: "step", message: `querying NotebookLM for ${count} MCQs` });
    const prompt = buildMcqPrompt(count, difficulty);
    const queryStdout = await nlmQuery(cfg, notebookId, prompt);
    const mcqs = parseMcqArray(queryStdout);
    if (mcqs.length === 0) {
      throw new Error("NotebookLM returned no parseable MCQs");
    }
    const tagged: MCQ[] = mcqs.map((m) => ({
      ...m,
      sourceKey: m.sourceKey ?? job.sourceKeys.join(";"),
    }));
    const deduped = dedupeMcqs(tagged);
    onProgress({
      type: "step",
      message: `parsed ${mcqs.length} MCQs (${deduped.length} unique)`,
    });

    // 5. Write CSV locally, upload to output bucket, presign.
    const csv = writeCsv(deduped, cfg.csvSchema);
    const csvPath = join(scratchDir, "output.csv");
    writeFileSync(csvPath, csv, "utf8");
    const outputKey = `mcq/${jobId}-${slugify(source) || "quiz"}.csv`;
    await uploadFile(s3, cfg.outputBucket, outputKey, csvPath, "text/csv");
    const presignedUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: cfg.outputBucket, Key: outputKey }),
      { expiresIn: cfg.presignTtlSeconds }
    );

    job = {
      ...job,
      status: "done",
      count: deduped.length,
      outputKey,
      endedAt: new Date().toISOString(),
    };
    writeJob(cfg.resolvedDataDir, job);

    const result: GenerateOutput = {
      jobId,
      s3Uri: `s3://${cfg.outputBucket}/${outputKey}`,
      presignedUrl,
      count: deduped.length,
      notebookId,
      outputKey,
    };
    onProgress({ type: "done", message: `job ${jobId} done`, data: { ...result } });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    job = {
      ...job,
      status: "error",
      endedAt: new Date().toISOString(),
      error: msg,
    };
    writeJob(cfg.resolvedDataDir, job);
    onProgress({ type: "error", message: msg, data: { jobId } });
    throw err;
  } finally {
    // Clean scratch directory regardless of outcome.
    try {
      rmSync(scratchDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

function buildMcqPrompt(count: number, difficulty: string): string {
  return [
    `Generate exactly ${count} multiple-choice questions at ${difficulty} difficulty,`,
    "covering the most important concepts in the uploaded source material.",
    "",
    "Return ONLY a JSON array. Each element must have this shape:",
    `{"question": "...", "options": {"A": "...", "B": "...", "C": "...", "D": "..."}, "correct": "A" | "B" | "C" | "D", "explanation": "..."}`,
    "",
    "Do not include any prose, headings, or markdown — only the JSON array.",
  ].join("\n");
}

function resolveSourceFromIndex(
  dbPath: string,
  bucket: string,
  spec: string
): FileRecord[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const exact = db
      .prepare(
        `SELECT bucket, key, size, etag, content_type as contentType,
                last_modified as lastModified, indexed_at as indexedAt
           FROM files WHERE bucket = ? AND key = ?`
      )
      .get(bucket, spec) as FileRecord | undefined;
    if (exact) return [exact];

    const norm = spec.endsWith("/") ? spec : spec + "/";
    return db
      .prepare(
        `SELECT bucket, key, size, etag, content_type as contentType,
                last_modified as lastModified, indexed_at as indexedAt
           FROM files
          WHERE bucket = ? AND key LIKE ?
          ORDER BY key
          LIMIT 100`
      )
      .all(bucket, norm + "%") as FileRecord[];
  } finally {
    db.close();
  }
}

function buildS3Client(cfg: ResolvedQuizConfig): S3Client {
  const endpoint = /^https?:\/\//.test(cfg.endpoint) ? cfg.endpoint : `https://${cfg.endpoint}`;
  return new S3Client({
    endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    forcePathStyle: true,
  });
}

async function downloadToFile(
  client: S3Client,
  bucket: string,
  key: string,
  destPath: string
): Promise<void> {
  mkdirSync(dirname(destPath), { recursive: true });
  const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!out.Body) throw new Error(`empty body for s3://${bucket}/${key}`);
  await streamPipeline(out.Body as Readable, createWriteStream(destPath));
}

async function uploadFile(
  client: S3Client,
  bucket: string,
  key: string,
  srcPath: string,
  contentType: string
): Promise<void> {
  const body = readFileSync(srcPath);
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType })
  );
}

async function nlmCreateNotebook(cfg: ResolvedQuizConfig, title: string): Promise<string> {
  const res = await runNlm(cfg, ["notebook", "create", title]);
  const m = res.stdout.match(/(?:notebook\s+)?id[:\s]+([a-zA-Z0-9_-]+)/i);
  if (!m) throw new Error(`failed to parse notebook ID: ${res.stdout.slice(0, 200)}`);
  return m[1];
}

async function nlmAddSource(
  cfg: ResolvedQuizConfig,
  notebookId: string,
  filePath: string
): Promise<void> {
  await runNlm(cfg, ["source", "add", notebookId, "--file", filePath]);
}

async function nlmQuery(
  cfg: ResolvedQuizConfig,
  notebookId: string,
  prompt: string
): Promise<string> {
  const res = await runNlm(cfg, ["notebook", "query", notebookId, prompt, "--json"]);
  return res.stdout;
}

interface RunOut {
  stdout: string;
  stderr: string;
}

function runNlm(cfg: ResolvedQuizConfig, args: string[]): Promise<RunOut> {
  return new Promise((resolve, reject) => {
    const child = spawn(cfg.resolvedNlmBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`nlm timed out: nlm ${args.slice(0, 2).join(" ")}`));
    }, 180_000);
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`nlm spawn failed: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = stdout + "\n" + stderr;
      if (/rate limit|quota exceeded|429|too many requests/i.test(text)) {
        reject(new Error("NotebookLM rate limit reached"));
        return;
      }
      if (code !== 0) {
        reject(new Error(`nlm exited ${code}: ${stderr.trim() || stdout.slice(0, 200)}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
