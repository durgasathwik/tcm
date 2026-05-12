import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SqliteStore } from "./sqlite-store.js";
import { slugify } from "@tcm/shared";

export function writeFolderSummaries(
  store: SqliteStore,
  bucket: string,
  outDir: string
): { written: number } {
  mkdirSync(outDir, { recursive: true });
  const top = store.listTopFolders(bucket);
  let written = 0;

  // One summary for the bucket itself (subject overview).
  const allFiles = store.listByPrefix(bucket, "", 5000);
  const subjectMd = renderSubjectMarkdown(bucket, allFiles.length, allFiles);
  writeFileSync(join(outDir, `subject-${slugify(bucket)}.md`), subjectMd, "utf8");
  written++;

  for (const folder of top) {
    const files = store.listByPrefix(bucket, folder.path, 1000);
    const slug = `${slugify(bucket)}-${slugify(folder.path)}`;
    const md = renderFolderMarkdown(bucket, folder.path, folder.fileCount, folder.totalBytes, files);
    writeFileSync(join(outDir, `${slug}.md`), md, "utf8");
    written++;
  }
  return { written };
}

function renderFolderMarkdown(
  bucket: string,
  path: string,
  fileCount: number,
  totalBytes: number,
  files: { key: string; size: number; lastModified: string }[]
): string {
  const head = [
    "---",
    "source: tcm-idrive",
    `subject: ${bucket}`,
    `folder: ${path}`,
    `file_count: ${fileCount}`,
    `total_bytes: ${totalBytes}`,
    `indexed_at: ${new Date().toISOString()}`,
    `tags: [tcm, study, ${bucket.toLowerCase()}, ${path.toLowerCase().replace(/\s+/g, "-")}]`,
    "---",
    "",
    `# ${bucket}/${path}`,
    "",
    `${fileCount} files, ${humanBytes(totalBytes)} total.`,
    "",
    "## Files",
    "",
  ];
  const body = files
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((f) => `- \`${f.key}\` (${humanBytes(f.size)}, modified ${f.lastModified})`)
    .join("\n");
  return head.join("\n") + body + "\n";
}

function renderSubjectMarkdown(
  bucket: string,
  fileCount: number,
  files: { key: string; size: number; lastModified: string }[]
): string {
  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
  const head = [
    "---",
    "source: tcm-idrive",
    `subject: ${bucket}`,
    `file_count: ${fileCount}`,
    `total_bytes: ${totalBytes}`,
    `indexed_at: ${new Date().toISOString()}`,
    `tags: [tcm, study, subject, ${bucket.toLowerCase()}]`,
    "---",
    "",
    `# ${bucket}`,
    "",
    `Subject bucket with ${fileCount} files, ${humanBytes(totalBytes)} total.`,
    "",
  ];
  return head.join("\n") + "\n";
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
