import type { SqliteStore } from "../sqlite-store.js";
import type { ResolvedIdriveConfig } from "../config.js";

export interface TreeOpts {
  cfg: ResolvedIdriveConfig;
  store: SqliteStore;
  depth: number;
  /** Optional bucket to limit the tree to. */
  bucket?: string;
}

export function runTree(opts: TreeOpts): void {
  const { store, depth, bucket } = opts;
  const buckets = bucket ? [bucket] : store.distinctBuckets();
  for (const b of buckets) {
    process.stdout.write(`📦 ${b} (${store.count(b)} files)\n`);
    const top = store.listTopFolders(b);
    for (const folder of top) walk(store, b, folder.path, 1, depth);
    if (top.length === 0) process.stdout.write("  (no folders)\n");
  }
}

function walk(
  store: SqliteStore,
  bucket: string,
  path: string,
  level: number,
  maxDepth: number
): void {
  const indent = "  ".repeat(level);
  const folder = store
    .listSubFolders(bucket, path.split("/").slice(0, -1).join("/"))
    .find((f) => f.path === path);
  const count = folder?.fileCount ?? 0;
  process.stdout.write(`${indent}📁 ${path.split("/").pop()} (${count})\n`);
  if (level >= maxDepth) return;
  const subs = store.listSubFolders(bucket, path);
  for (const s of subs) walk(store, bucket, s.path, level + 1, maxDepth);
}
