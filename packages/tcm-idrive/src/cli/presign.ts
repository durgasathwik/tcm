import type { S3Client } from "@aws-sdk/client-s3";
import { presignDownload, presignUpload } from "../s3-client.js";
import type { ResolvedIdriveConfig } from "../config.js";
import { parseSourceSpec } from "../config.js";

export interface PresignOpts {
  cfg: ResolvedIdriveConfig;
  client: S3Client;
  /** "<bucket>/<key>" spec */
  spec: string;
  ttl: number;
  /** Presign an upload (PUT) URL instead of a download (GET) URL. */
  put?: boolean;
  /** Content type the uploader must send (PUT only). */
  contentType?: string;
}

export async function runPresign(opts: PresignOpts): Promise<void> {
  const { client, spec, ttl, put, contentType } = opts;
  const { bucket, key } = parseSourceSpec(spec);
  if (!bucket || !key) {
    process.stderr.write(`usage: presign <bucket>/<key>\n`);
    process.exit(1);
  }
  const url = put
    ? await presignUpload(client, bucket, key, ttl, contentType)
    : await presignDownload(client, bucket, key, ttl);
  process.stdout.write(url + "\n");
}
