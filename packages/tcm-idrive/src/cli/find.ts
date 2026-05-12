import type { SqliteStore } from "../sqlite-store.js";
import type { ResolvedIdriveConfig } from "../config.js";

export interface FindOpts {
  cfg: ResolvedIdriveConfig;
  store: SqliteStore;
  query: string;
  limit: number;
}

export function runFind(opts: FindOpts): void {
  const { cfg, store, query, limit } = opts;
  const hits = store.find(cfg.sourceBucket, query, limit);
  if (hits.length === 0) {
    process.stdout.write(`# no matches for "${query}"\n`);
    return;
  }
  process.stdout.write(`# ${hits.length} match${hits.length === 1 ? "" : "es"} for "${query}"\n`);
  for (const h of hits) process.stdout.write(`${h.key} (${h.size} B)\n`);
}
