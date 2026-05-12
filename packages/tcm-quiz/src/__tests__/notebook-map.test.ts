import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadNotebookMap,
  saveNotebookMap,
  upsertEntry,
  getEntry,
  sourcesToAdd,
  notebookMapPath,
} from "../notebook-map.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tcm-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("notebook-map", () => {
  it("returns empty object when file missing", () => {
    expect(loadNotebookMap(notebookMapPath(dir))).toEqual({});
  });

  it("roundtrips through save+load", () => {
    const path = notebookMapPath(dir);
    let map = {};
    map = upsertEntry(map, "Biology/Genetics", "nb-123", [
      { key: "Biology/Genetics/mendel.pdf", etag: "abc" },
    ]);
    saveNotebookMap(path, map);
    const loaded = loadNotebookMap(path);
    const entry = getEntry(loaded, "Biology/Genetics");
    expect(entry?.notebookId).toBe("nb-123");
    expect(entry?.sources["Biology/Genetics/mendel.pdf"].etag).toBe("abc");
  });

  it("sourcesToAdd returns net-new keys", () => {
    let map = {};
    map = upsertEntry(map, "X", "nb-1", [{ key: "a", etag: "e1" }]);
    const entry = getEntry(map, "X");
    const toAdd = sourcesToAdd(entry, [
      { key: "a", etag: "e1" },
      { key: "b", etag: "e2" },
    ]);
    expect(toAdd).toEqual([{ key: "b", etag: "e2" }]);
  });

  it("sourcesToAdd flags etag changes as needing re-add", () => {
    let map = {};
    map = upsertEntry(map, "X", "nb-1", [{ key: "a", etag: "old" }]);
    const entry = getEntry(map, "X");
    const toAdd = sourcesToAdd(entry, [{ key: "a", etag: "new" }]);
    expect(toAdd).toEqual([{ key: "a", etag: "new" }]);
  });

  it("sourcesToAdd returns all when no entry exists", () => {
    const toAdd = sourcesToAdd(undefined, [{ key: "a", etag: "e" }]);
    expect(toAdd).toHaveLength(1);
  });
});
