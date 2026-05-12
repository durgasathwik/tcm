import type { S3Client } from "@aws-sdk/client-s3";
import { listAllObjects, cleanEtag } from "../s3-client.js";
import type { SqliteStore } from "../sqlite-store.js";
import type { ResolvedIdriveConfig } from "../config.js";
import { writeFolderSummaries } from "../memory-sync.js";
import { expandPath } from "../config.js";

export interface SyncOpts {
  cfg: ResolvedIdriveConfig;
  client: S3Client;
  store: SqliteStore;
  prefix?: string;
  dryRun: boolean;
}

export async function runSync(opts: SyncOpts): Promise<void> {
  const { cfg, client, store, prefix, dryRun } = opts;
  process.stdout.write(
    `[tcm-idrive] sync starting bucket=${cfg.sourceBucket}${prefix ? ` prefix=${prefix}` : ""}${dryRun ? " (dry-run)" : ""}\n`
  );

  const seen = new Set<string>();
  const previouslyKnown = store.allKeys(cfg.sourceBucket);
  let added = 0;
  let changed = 0;

  const indexedAt = new Date().toISOString();

  for await (const obj of listAllObjects(client, cfg.sourceBucket, prefix)) {
    if (!obj.Key) continue;
    if (obj.Key.endsWith("/")) continue; // S3 "folder marker" objects
    seen.add(obj.Key);
    const etag = cleanEtag(obj.ETag);
    const existing = store.getFile(cfg.sourceBucket, obj.Key);
    const record = {
      bucket: cfg.sourceBucket,
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
  // Compute deletions only for full-bucket sync (no prefix filter).
  if (!prefix) {
    for (const key of previouslyKnown) {
      if (!seen.has(key)) {
        removed++;
        if (!dryRun) store.deleteFile(cfg.sourceBucket, key);
      }
    }
  }

  if (!dryRun) store.rebuildFolders(cfg.sourceBucket);

  let memorySummary = "";
  if (!dryRun && cfg.memoryDir) {
    const outDir = expandPath(cfg.memoryDir);
    const { written } = writeFolderSummaries(store, cfg.sourceBucket, outDir);
    memorySummary = ` memory-summaries=${written} dir=${outDir}`;
  }

  const total = store.count(cfg.sourceBucket);
  process.stdout.write(
    `[tcm-idrive] sync done +${added} new, ~${changed} changed, -${removed} removed, total=${total}${memorySummary}\n`
  );
}
