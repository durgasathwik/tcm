/**
 * Load key/value pairs from a tcm `.env` file written by `openclaw tcm setup`.
 * Falls back gracefully to {} when the file doesn't exist or can't be read,
 * because the plugin should never crash just because the file isn't there.
 *
 * `dotenv` syntax we honor (deliberately minimal — what `tcm setup` writes):
 *   KEY=value
 *   KEY="value with spaces"
 *   # comments and blank lines
 *
 * Keys not matching `^[A-Z_][A-Z0-9_]*$` are skipped.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve as resolvePath, join } from "node:path";

function expandPath(p: string): string {
  if (p.startsWith("~")) return resolvePath(homedir(), p.slice(2));
  return resolvePath(p);
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/** Read `.env` at the given path; return {} if absent or unreadable. */
export function readEnvFile(path: string): Record<string, string> {
  const expanded = expandPath(path);
  if (!existsSync(expanded)) return {};
  try {
    const out: Record<string, string> = {};
    for (const line of readFileSync(expanded, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = stripQuotes(m[2]);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Merge process env with `<dataDir>/.env` values. Process env wins.
 * Use this in plugin `resolveConfig` so the user can put creds in
 * ~/.tcm/.env without having to source the file before starting OpenClaw.
 */
export function mergeEnvFromFile(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env
): Record<string, string | undefined> {
  const fileEnv = readEnvFile(join(expandPath(dataDir), ".env"));
  const merged: Record<string, string | undefined> = { ...fileEnv };
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) merged[k] = v;
  }
  return merged;
}
