import type { S3Client } from "@aws-sdk/client-s3";
import { listAllObjects, cleanEtag, resolveSubjectBuckets } from "../s3-client.js";
import type { SqliteStore } from "../sqlite-store.js";
import type { ResolvedIdriveConfig } from "../config.js";
import { writeFolderSummaries } from "../memory-sync.js";
import { expandPath } from "../config.js";

export interface SyncOpts {
  cfg: ResolvedIdriveConfig;
  client: S3Client;
  store: SqliteStore;
  /** Optional `<bucket>` or `<bucket>/<prefix>` to limit the sync. */
  prefix?: string;
  dryRun: boolean;
}

export async function runSync(opts: SyncOpts): Promise<void> {
  const { cfg, client, store, prefix, dryRun } = opts;

  // Resolve which buckets to sync.
  let targets: Array<{ bucket: string; prefix?: string }>;
  if (prefix) {
    const slash = prefix.indexOf("/");
    const bucket = slash === -1 ? prefix : prefix.slice(0, slash);
    const subPrefix = slash === -1 ? undefined : prefix.slice(slash + 1);
    targets = [{ bucket, prefix: subPrefix }];
  } else {
    const buckets = await resolveSubjectBuckets(client, cfg.subjectBuckets, cfg.excludeBuckets);
    targets = buckets.map((b) => ({ bucket: b }));
  }

  process.stdout.write(
    `[tcm-idrive] sync starting buckets=[${targets.map((t) => t.bucket).join(",")}]${dryRun ? " (dry-run)" : ""}\n`
  );

  let totalAdded = 0;
  let totalChanged = 0;
  let totalRemoved = 0;
  const indexedAt = new Date().toISOString();

  for (const target of targets) {
    const seen = new Set<string>();
    const previouslyKnown = store.allKeys(target.bucket);
    let added = 0;
    let changed = 0;

    for await (const obj of listAllObjects(client, target.bucket, target.prefix)) {
      if (!obj.Key) continue;
      if (obj.Key.endsWith("/")) continue;
      seen.add(obj.Key);
      const etag = cleanEtag(obj.ETag);
      const existing = store.getFile(target.bucket, obj.Key);
      const record = {
        bucket: target.bucket,
        key: obj.Key,
        size: obj.Size ?? 0,
        etag,
        contentType: null,
        lastModified: obj.LastModified?.toISOString() ?? new Date().toISOString(),
        indexedAt,
      };
      if (!existing) {
        added++;
        if (!dryRun) store.upsertFile(record);
      } else if (existing.etag !== etag || existing.size !== record.size) {
        changed++;
        if (!dryRun) store.upsertFile(record);
      }
    }

    let removed = 0;
    if (!target.prefix) {
      for (const key of previouslyKnown) {
        if (!seen.has(key)) {
          removed++;
          if (!dryRun) store.deleteFile(target.bucket, key);
        }
      }
    }

    if (!dryRun) store.rebuildFolders(target.bucket);
    totalAdded += added;
    totalChanged += changed;
    totalRemoved += removed;
    const bucketTotal = store.count(target.bucket);
    process.stdout.write(
      `[tcm-idrive] · ${target.bucket}: +${added} ~${changed} -${removed} total=${bucketTotal}\n`
    );
  }

  let memorySummary = "";
  if (!dryRun && cfg.memoryDir) {
    const outDir = expandPath(cfg.memoryDir);
    let total = 0;
    for (const t of targets) {
      const { written } = writeFolderSummaries(store, t.bucket, outDir);
      total += written;
    }
    memorySummary = ` memory-summaries=${total} dir=${outDir}`;
  }

  process.stdout.write(
    `[tcm-idrive] sync done +${totalAdded} ~${totalChanged} -${totalRemoved} across ${targets.length} bucket(s)${memorySummary}\n`
  );
}
