import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";

export class NlmError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
    public readonly stdout: string
  ) {
    super(message);
  }
}

export class NlmRateLimitError extends NlmError {
  constructor(stdout: string, stderr: string) {
    super("NotebookLM rate limit reached (quota exceeded).", null, stderr, stdout);
  }
}

export interface NlmRunnerConfig {
  binary: string;
  timeoutMs: number;
}

export function expandPath(p: string): string {
  if (p.startsWith("~")) return resolve(homedir(), p.slice(2));
  return p;
}

export function defaultConfig(raw: Record<string, unknown> | undefined): NlmRunnerConfig {
  const bin = typeof raw?.nlmBin === "string" ? raw.nlmBin : "~/.local/bin/nlm";
  const timeoutMs = typeof raw?.spawnTimeoutMs === "number" ? raw.spawnTimeoutMs : 120_000;
  return { binary: expandPath(bin), timeoutMs };
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runNlm(cfg: NlmRunnerConfig, args: string[]): Promise<RunResult> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cfg.binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      rejectP(new NlmError(`nlm timed out after ${cfg.timeoutMs}ms`, null, stderr, stdout));
    }, cfg.timeoutMs);

    child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    child.on("error", (err) => {
      clearTimeout(timer);
      rejectP(new NlmError(`nlm spawn failed: ${err.message}`, null, stderr, stdout));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (isRateLimited(stdout + "\n" + stderr)) {
        rejectP(new NlmRateLimitError(stdout, stderr));
        return;
      }
      if (code !== 0) {
        rejectP(
          new NlmError(`nlm exited with code ${code}: ${stderr.trim() || "(no stderr)"}`, code, stderr, stdout)
        );
        return;
      }
      resolveP({ stdout, stderr, exitCode: code });
    });
  });
}

/**
 * Spawn the real `nlm` binary with the given argv, inheriting the parent
 * process's stdio (stdin/stdout/stderr stream verbatim). Resolves with the
 * child's exit code. Used by the CLI passthrough so `openclaw tcm nlm ...`
 * behaves exactly like invoking `nlm ...` directly.
 */
export async function runNlmPassthrough(cfg: NlmRunnerConfig, args: string[]): Promise<number> {
  return new Promise((resolveP) => {
    const child = spawn(cfg.binary, args, { stdio: "inherit" });
    child.on("error", (err) => {
      process.stderr.write(`nlm spawn failed: ${err.message}\n`);
      resolveP(127);
    });
    child.on("close", (code, signal) => {
      if (code === null) {
        // Killed by signal — mirror shell convention (128 + signal number).
        resolveP(signal ? 128 : 1);
        return;
      }
      resolveP(code);
    });
  });
}

export function isRateLimited(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("rate limit") ||
    t.includes("quota exceeded") ||
    t.includes("429") ||
    t.includes("too many requests")
  );
}

/**
 * Find the first valid JSON object or array embedded in text. The nlm CLI
 * sometimes emits banner lines before the JSON payload.
 */
export function looseParseJson<T = unknown>(text: string): T {
  const candidates = findJsonCandidates(text);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try next
    }
  }
  throw new Error(`no parsable JSON found in nlm output: ${text.slice(0, 200)}`);
}

function findJsonCandidates(text: string): string[] {
  const out: string[] = [];
  for (const start of indicesOf(text, /[{[]/g)) {
    const end = matchingClose(text, start);
    if (end !== -1) out.push(text.slice(start, end + 1));
  }
  // Try longest first — the outermost match is most likely the real payload.
  return out.sort((a, b) => b.length - a.length);
}

function* indicesOf(s: string, re: RegExp): Generator<number> {
  let m: RegExpExecArray | null;
  const r = new RegExp(re.source, re.flags);
  while ((m = r.exec(s)) !== null) yield m.index;
}

function matchingClose(s: string, openIdx: number): number {
  const open = s[openIdx];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Parse the standard nlm query response: { value: { answer, references, ... } } */
export function unwrapQueryAnswer(parsed: unknown): {
  answer: string;
  references: Array<{ source_id?: string; cited_text?: string }>;
} {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("nlm query response is not an object");
  }
  const obj = parsed as Record<string, unknown>;
  const value = (obj.value ?? obj) as Record<string, unknown>;
  const answer = typeof value.answer === "string" ? value.answer : "";
  const references = Array.isArray(value.references) ? (value.references as never[]) : [];
  return { answer, references };
}

/** Parse `nlm notebook create` output to extract the notebook ID. */
export function parseNotebookId(stdout: string): string | null {
  // Examples we've seen: "ID: <uuid>" or "Notebook ID: <uuid>".
  const m = stdout.match(/(?:notebook\s+)?id[:\s]+([a-zA-Z0-9_-]+)/i);
  return m ? m[1] : null;
}
