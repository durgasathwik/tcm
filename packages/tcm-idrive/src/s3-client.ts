import {
  S3Client,
  ListObjectsV2Command,
  ListBucketsCommand,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  type _Object,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createWriteStream, readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { ResolvedIdriveConfig } from "./config.js";

export function buildClient(cfg: ResolvedIdriveConfig): S3Client {
  // IDrive e2 sometimes returns bare hostnames; ensure scheme.
  const endpoint = /^https?:\/\//.test(cfg.endpoint) ? cfg.endpoint : `https://${cfg.endpoint}`;
  return new S3Client({
    endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    forcePathStyle: true,
  });
}

export async function* listAllObjects(
  client: S3Client,
  bucket: string,
  prefix?: string
): AsyncGenerator<_Object> {
  let token: string | undefined;
  do {
    const out = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      })
    );
    for (const obj of out.Contents ?? []) yield obj;
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
}

export async function downloadToFile(
  client: S3Client,
  bucket: string,
  key: string,
  destPath: string
): Promise<void> {
  mkdirSync(dirname(destPath), { recursive: true });
  const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = out.Body;
  if (!body) throw new Error(`empty body for s3://${bucket}/${key}`);
  // Body is a Node Readable stream in node runtimes.
  await pipeline(body as Readable, createWriteStream(destPath));
}

export async function presignDownload(
  client: S3Client,
  bucket: string,
  key: string,
  ttlSeconds: number
): Promise<string> {
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: ttlSeconds,
  });
}

export async function objectExists(
  client: S3Client,
  bucket: string,
  key: string
): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

export async function uploadFile(
  client: S3Client,
  bucket: string,
  key: string,
  srcPath: string,
  contentType: string
): Promise<void> {
  const body = readFileSync(srcPath);
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType })
  );
}

export async function presignUpload(
  client: S3Client,
  bucket: string,
  key: string,
  ttlSeconds: number,
  contentType?: string
): Promise<string> {
  return getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), {
    expiresIn: ttlSeconds,
  });
}

export async function listAllBuckets(client: S3Client): Promise<string[]> {
  const out = await client.send(new ListBucketsCommand({}));
  return (out.Buckets ?? []).map((b) => b.Name ?? "").filter(Boolean);
}

/**
 * Resolve which buckets the plugin should treat as subjects.
 * - If config.subjectBuckets is non-empty, use that list verbatim.
 * - Otherwise, ListBuckets and exclude anything in excludeBuckets.
 */
export async function resolveSubjectBuckets(
  client: S3Client,
  explicit: string[],
  exclude: string[]
): Promise<string[]> {
  if (explicit.length > 0) return explicit;
  const all = await listAllBuckets(client);
  const excl = new Set(exclude);
  return all.filter((b) => !excl.has(b));
}

/** Strip an etag's surrounding quotes if present. */
export function cleanEtag(etag: string | undefined): string {
  if (!etag) return "";
  return etag.replace(/^"(.+)"$/, "$1");
}
