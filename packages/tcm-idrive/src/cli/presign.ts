import type { S3Client } from "@aws-sdk/client-s3";
import { presignDownload } from "../s3-client.js";
import type { ResolvedIdriveConfig } from "../config.js";

export interface PresignOpts {
  cfg: ResolvedIdriveConfig;
  client: S3Client;
  key: string;
  ttl: number;
}

export async function runPresign(opts: PresignOpts): Promise<void> {
  const url = await presignDownload(opts.client, opts.cfg.sourceBucket, opts.key, opts.ttl);
  process.stdout.write(url + "\n");
}
