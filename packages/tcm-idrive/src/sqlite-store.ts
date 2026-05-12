import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FileRecord, FolderRecord } from "@tcm/shared";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  bucket TEXT NOT NULL,
  key TEXT NOT NULL,
  size INTEGER NOT NULL,
  etag TEXT NOT NULL,
  content_type TEXT,
  last_modified TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  PRIMARY KEY (bucket, key)
);

CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(key, content='files', content_rowid='rowid');

CREATE TABLE IF NOT EXISTS folders (
  bucket TEXT NOT NULL,
  path TEXT NOT NULL,
  file_count INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, path)
);

CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
  INSERT INTO files_fts(rowid, key) VALUES (new.rowid, new.key);
END;
CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
  INSERT INTO files_fts(files_fts, rowid, key) VALUES('delete', old.rowid, old.key);
END;
CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
  INSERT INTO files_fts(files_fts, rowid, key) VALUES('delete', old.rowid, old.key);
  INSERT INTO files_fts(rowid, key) VALUES (new.rowid, new.key);
END;
`;

export class SqliteStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  static inMemory(): SqliteStore {
    return new SqliteStore(":memory:");
  }

  close(): void {
    this.db.close();
  }

  upsertFile(record: FileRecord): void {
    this.db
      .prepare(
        `INSERT INTO files (bucket, key, size, etag, content_type, last_modified, indexed_at)
         VALUES (@bucket, @key, @size, @etag, @contentType, @lastModified, @indexedAt)
         ON CONFLICT(bucket, key) DO UPDATE SET
           size = excluded.size,
           etag = excluded.etag,
           content_type = excluded.content_type,
           last_modified = excluded.last_modified,
           indexed_at = excluded.indexed_at`
      )
      .run(record);
  }

  deleteFile(bucket: string, key: string): void {
    this.db.prepare("DELETE FROM files WHERE bucket = ? AND key = ?").run(bucket, key);
  }

  getFile(bucket: string, key: string): FileRecord | null {
    const row = this.db
      .prepare(
        `SELECT bucket, key, size, etag, content_type as contentType,
                last_modified as lastModified, indexed_at as indexedAt
           FROM files WHERE bucket = ? AND key = ?`
      )
      .get(bucket, key) as FileRecord | undefined;
    return row ?? null;
  }

  /** All known keys for a bucket; used during sync to compute deletions. */
  allKeys(bucket: string): Set<string> {
    const rows = this.db
      .prepare("SELECT key FROM files WHERE bucket = ?")
      .all(bucket) as Array<{ key: string }>;
    return new Set(rows.map((r) => r.key));
  }

  listByPrefix(bucket: string, prefix: string, limit = 500): FileRecord[] {
    const norm = prefix.endsWith("/") || prefix === "" ? prefix : prefix + "/";
    return this.db
      .prepare(
        `SELECT bucket, key, size, etag, content_type as contentType,
                last_modified as lastModified, indexed_at as indexedAt
           FROM files
          WHERE bucket = ? AND key LIKE ?
          ORDER BY key
          LIMIT ?`
      )
      .all(bucket, norm + "%", limit) as FileRecord[];
  }

  /** Both exact prefix (folder contents) and starts-with (file path). */
  resolveSource(bucket: string, spec: string): FileRecord[] {
    const exact = this.getFile(bucket, spec);
    if (exact) return [exact];
    return this.listByPrefix(bucket, spec);
  }

  find(bucket: string, query: string, limit = 20): FileRecord[] {
    // FTS5 token: match each whitespace-split word as a prefix.
    const tokens = query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => t.replace(/[^a-zA-Z0-9]/g, "") + "*")
      .filter((t) => t.length > 1);
    if (tokens.length === 0) return [];
    const fts = tokens.join(" ");
    return this.db
      .prepare(
        `SELECT f.bucket, f.key, f.size, f.etag, f.content_type as contentType,
                f.last_modified as lastModified, f.indexed_at as indexedAt
           FROM files_fts JOIN files f ON files_fts.rowid = f.rowid
          WHERE files_fts MATCH ? AND f.bucket = ?
          ORDER BY rank
          LIMIT ?`
      )
      .all(fts, bucket, limit) as FileRecord[];
  }

  rebuildFolders(bucket: string): void {
    this.db.prepare("DELETE FROM folders WHERE bucket = ?").run(bucket);
    const rows = this.db
      .prepare("SELECT key, size FROM files WHERE bucket = ?")
      .all(bucket) as Array<{ key: string; size: number }>;
    const map = new Map<string, { count: number; bytes: number }>();
    for (const r of rows) {
      const parts = r.key.split("/");
      if (parts.length === 1) continue;
      for (let i = 1; i < parts.length; i++) {
        const path = parts.slice(0, i).join("/");
        const cur = map.get(path) ?? { count: 0, bytes: 0 };
        cur.count++;
        cur.bytes += r.size;
        map.set(path, cur);
      }
    }
    const insert = this.db.prepare(
      "INSERT INTO folders (bucket, path, file_count, total_bytes) VALUES (?, ?, ?, ?)"
    );
    const tx = this.db.transaction(() => {
      for (const [path, v] of map) insert.run(bucket, path, v.count, v.bytes);
    });
    tx();
  }

  listTopFolders(bucket: string): FolderRecord[] {
    return this.db
      .prepare(
        `SELECT bucket, path, file_count as fileCount, total_bytes as totalBytes
           FROM folders
          WHERE bucket = ? AND path NOT LIKE '%/%'
          ORDER BY path`
      )
      .all(bucket) as FolderRecord[];
  }

  listSubFolders(bucket: string, parent: string): FolderRecord[] {
    const prefix = parent === "" ? "" : parent + "/";
    return this.db
      .prepare(
        `SELECT bucket, path, file_count as fileCount, total_bytes as totalBytes
           FROM folders
          WHERE bucket = ? AND path LIKE ? AND path NOT LIKE ?
          ORDER BY path`
      )
      .all(bucket, prefix + "%", prefix + "%/%") as FolderRecord[];
  }

  /** All bucket names that have at least one file in the index. */
  distinctBuckets(): string[] {
    const rows = this.db
      .prepare("SELECT DISTINCT bucket FROM files ORDER BY bucket")
      .all() as Array<{ bucket: string }>;
    return rows.map((r) => r.bucket);
  }

  /** total file count for a bucket. */
  count(bucket: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as c FROM files WHERE bucket = ?")
      .get(bucket) as { c: number };
    return row.c;
  }

  /** Run fn inside a transaction. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

export function defaultDbPath(dataDir: string): string {
  return join(dataDir, "index.db");
}
