import type { SqliteStore } from "../sqlite-store.js";
import type { ResolvedIdriveConfig } from "../config.js";

export interface LsOpts {
  cfg: ResolvedIdriveConfig;
  store: SqliteStore;
  path: string;
}

export function runLs(opts: LsOpts): void {
  const { cfg, store, path } = opts;
  const folders = store.listSubFolders(cfg.sourceBucket, path);
  const fileRecords = store.listByPrefix(cfg.sourceBucket, path, 200);
  // Direct children only: drop entries that have a / after the prefix.
  const prefix = path === "" ? "" : path + "/";
  const direct = fileRecords.filter((f) => !f.key.slice(prefix.length).includes("/"));

  process.stdout.write(`# ${path || "/"}\n`);
  if (folders.length === 0 && direct.length === 0) {
    process.stdout.write("(empty)\n");
    return;
  }
  for (const f of folders) {
    const name = f.path.slice(prefix.length);
    process.stdout.write(`📁 ${name} (${f.fileCount} files)\n`);
  }
  for (const f of direct) {
    const name = f.key.slice(prefix.length);
    process.stdout.write(`   ${name} (${f.size} B)\n`);
  }
}
