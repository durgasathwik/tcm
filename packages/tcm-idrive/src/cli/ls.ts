import type { SqliteStore } from "../sqlite-store.js";
import type { ResolvedIdriveConfig } from "../config.js";
import { parseSourceSpec } from "../config.js";

export interface LsOpts {
  cfg: ResolvedIdriveConfig;
  store: SqliteStore;
  /** "" lists all subject buckets; "<bucket>" lists top folders; "<bucket>/<path>" lists folder contents. */
  path: string;
}

export function runLs(opts: LsOpts): void {
  const { store, path } = opts;

  if (path === "") {
    // List all known buckets from the index.
    const buckets = store.distinctBuckets();
    process.stdout.write("# subject buckets\n");
    if (buckets.length === 0) {
      process.stdout.write("(no buckets indexed yet — run `openclaw tcm idrive sync`)\n");
      return;
    }
    for (const b of buckets) {
      process.stdout.write(`📦 ${b} (${store.count(b)} files)\n`);
    }
    return;
  }

  const { bucket, key } = parseSourceSpec(path);
  const folders = store.listSubFolders(bucket, key);
  const fileRecords = store.listByPrefix(bucket, key, 200);
  const prefix = key === "" ? "" : key + "/";
  const direct = fileRecords.filter((f) => !f.key.slice(prefix.length).includes("/"));

  process.stdout.write(`# ${bucket}/${key || ""}\n`);
  if (folders.length === 0 && direct.length === 0) {
    process.stdout.write("(empty or not indexed — run `openclaw tcm idrive sync`)\n");
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
