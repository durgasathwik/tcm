import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { NotebookMap, type NotebookMapEntry } from "@tcm/shared";
import type { NotebookMap as NotebookMapType } from "@tcm/shared";

export function notebookMapPath(dataDir: string): string {
  return join(dataDir, "notebook-map.json");
}

export function loadNotebookMap(path: string): NotebookMapType {
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const parsed = NotebookMap.safeParse(raw);
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function saveNotebookMap(path: string, map: NotebookMapType): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(map, null, 2), "utf8");
  renameSync(tmp, path);
}

export function getEntry(map: NotebookMapType, topic: string): NotebookMapEntry | undefined {
  return map[topic];
}

export function upsertEntry(
  map: NotebookMapType,
  topic: string,
  notebookId: string,
  addedSources: Array<{ key: string; etag: string }>
): NotebookMapType {
  const now = new Date().toISOString();
  const existing = map[topic];
  const sources = existing?.sources ?? {};
  for (const s of addedSources) {
    sources[s.key] = { etag: s.etag, addedAt: now };
  }
  return {
    ...map,
    [topic]: {
      topic,
      notebookId,
      sources,
      lastUsedAt: now,
    },
  };
}

/**
 * Diff a desired source list against what's already tracked in the notebook.
 * Returns the subset that needs to be added (either net-new or changed by etag).
 */
export function sourcesToAdd(
  entry: NotebookMapEntry | undefined,
  desired: Array<{ key: string; etag: string }>
): Array<{ key: string; etag: string }> {
  const tracked = entry?.sources ?? {};
  return desired.filter((d) => {
    const t = tracked[d.key];
    return !t || t.etag !== d.etag;
  });
}
