import type { SqliteStore } from "../sqlite-store.js";
import type { ResolvedIdriveConfig } from "../config.js";

export interface TreeOpts {
  cfg: ResolvedIdriveConfig;
  store: SqliteStore;
  depth: number;
}

export function runTree(opts: TreeOpts): void {
  const { cfg, store, depth } = opts;
  const top = store.listTopFolders(cfg.sourceBucket);
  process.stdout.write(`# ${cfg.sourceBucket}\n`);
  for (const folder of top) {
    walk(store, cfg.sourceBucket, folder.path, 1, depth);
  }
}

function walk(
  store: SqliteStore,
  bucket: string,
  path: string,
  level: number,
  maxDepth: number
): void {
  const indent = "  ".repeat(level - 1);
  const folder = store
    .listSubFolders(bucket, path.split("/").slice(0, -1).join("/"))
    .find((f) => f.path === path);
  const count = folder?.fileCount ?? 0;
  process.stdout.write(`${indent}📁 ${path.split("/").pop()} (${count})\n`);
  if (level >= maxDepth) return;
  const subs = store.listSubFolders(bucket, path);
  for (const s of subs) walk(store, bucket, s.path, level + 1, maxDepth);
}
