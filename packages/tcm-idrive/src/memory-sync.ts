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
  for (const folder of top) {
    const files = store.listByPrefix(bucket, folder.path, 1000);
    const slug = slugify(folder.path);
    const md = renderFolderMarkdown(folder.path, folder.fileCount, folder.totalBytes, files);
    writeFileSync(join(outDir, `${slug}.md`), md, "utf8");
    written++;
  }
  return { written };
}

function renderFolderMarkdown(
  path: string,
  fileCount: number,
  totalBytes: number,
  files: { key: string; size: number; lastModified: string }[]
): string {
  const head = [
    "---",
    "source: tcm-idrive",
    `folder: ${path}`,
    `file_count: ${fileCount}`,
    `total_bytes: ${totalBytes}`,
    `indexed_at: ${new Date().toISOString()}`,
    "tags: [tcm, study, " + path.toLowerCase().replace(/\s+/g, "-") + "]",
    "---",
    "",
    `# ${path}`,
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

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
