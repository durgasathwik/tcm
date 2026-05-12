import type { S3Client } from "@aws-sdk/client-s3";
import { downloadToFile } from "../s3-client.js";
import type { ResolvedIdriveConfig } from "../config.js";

export interface GetOpts {
  cfg: ResolvedIdriveConfig;
  client: S3Client;
  key: string;
  out: string;
}

export async function runGet(opts: GetOpts): Promise<void> {
  const { cfg, client, key, out } = opts;
  await downloadToFile(client, cfg.sourceBucket, key, out);
  process.stdout.write(`${out}\n`);
}
