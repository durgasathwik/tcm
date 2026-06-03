import type { S3Client } from "@aws-sdk/client-s3";
import { existsSync } from "node:fs";
import { basename, extname } from "node:path";
import { uploadFile, objectExists } from "../s3-client.js";
import type { ResolvedIdriveConfig } from "../config.js";
import { parseSourceSpec } from "../config.js";

/** Minimal extension → MIME map; falls back to application/octet-stream. */
const CONTENT_TYPES: Record<string, string> = {
  ".csv": "text/csv",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".html": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".zip": "application/zip",
};

export function guessContentType(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export interface PutOpts {
  cfg: ResolvedIdriveConfig;
  client: S3Client;
  /** "<bucket>" (key = filename) or "<bucket>/<key>". The caller picks the bucket. */
  spec: string;
  /** Local file to upload. */
  file: string;
  contentType?: string;
  /** Overwrite an existing object at the destination key. */
  overwrite?: boolean;
}

export async function runPut(opts: PutOpts): Promise<void> {
  const { client, spec, file, overwrite } = opts;
  const { bucket } = parseSourceSpec(spec);
  let { key } = parseSourceSpec(spec);

  if (!bucket) {
    process.stderr.write(`usage: put <bucket>[/<key>] --file <path>\n`);
    process.exit(1);
  }
  if (!existsSync(file)) {
    process.stderr.write(`put: local file not found: ${file}\n`);
    process.exit(1);
  }
  // Bucket-only spec → use the source filename as the key.
  if (!key) key = basename(file);

  // Don't silently clobber an existing object (the subject buckets are the
  // quiz read corpus). Require --overwrite to replace.
  if (!overwrite && (await objectExists(client, bucket, key))) {
    process.stderr.write(
      `put: s3://${bucket}/${key} already exists. Re-run with --overwrite to replace it.\n`
    );
    process.exit(1);
  }

  const contentType = opts.contentType ?? guessContentType(file);
  await uploadFile(client, bucket, key, file, contentType);
  process.stdout.write(`s3://${bucket}/${key}\n`);
}
