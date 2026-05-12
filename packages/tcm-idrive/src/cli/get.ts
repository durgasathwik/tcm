import type { S3Client } from "@aws-sdk/client-s3";
import { downloadToFile } from "../s3-client.js";
import type { ResolvedIdriveConfig } from "../config.js";
import { parseSourceSpec } from "../config.js";

export interface GetOpts {
  cfg: ResolvedIdriveConfig;
  client: S3Client;
  /** "<bucket>/<key>" spec */
  spec: string;
  out: string;
}

export async function runGet(opts: GetOpts): Promise<void> {
  const { client, spec, out } = opts;
  const { bucket, key } = parseSourceSpec(spec);
  if (!bucket || !key) {
    process.stderr.write(`usage: get <bucket>/<key> --out <path>\n`);
    process.exit(1);
  }
  await downloadToFile(client, bucket, key, out);
  process.stdout.write(`${out}\n`);
}
