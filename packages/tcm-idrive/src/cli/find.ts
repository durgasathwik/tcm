import type { SqliteStore } from "../sqlite-store.js";
import type { ResolvedIdriveConfig } from "../config.js";

export interface FindOpts {
  cfg: ResolvedIdriveConfig;
  store: SqliteStore;
  query: string;
  limit: number;
  /** Optional bucket to restrict search to. */
  bucket?: string;
}

export function runFind(opts: FindOpts): void {
  const { store, query, limit, bucket } = opts;
  const buckets = bucket ? [bucket] : store.distinctBuckets();
  const hits: Array<{ bucket: string; key: string; size: number }> = [];
  for (const b of buckets) {
    const bHits = store.find(b, query, limit);
    for (const h of bHits) hits.push({ bucket: h.bucket, key: h.key, size: h.size });
    if (hits.length >= limit) break;
  }
  if (hits.length === 0) {
    process.stdout.write(`# no matches for "${query}"\n`);
    return;
  }
  process.stdout.write(`# ${hits.length} match${hits.length === 1 ? "" : "es"} for "${query}"\n`);
  for (const h of hits.slice(0, limit)) {
    process.stdout.write(`${h.bucket}/${h.key} (${h.size} B)\n`);
  }
}
