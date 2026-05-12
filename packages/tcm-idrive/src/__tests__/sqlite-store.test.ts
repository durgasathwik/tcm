import { describe, it, expect } from "vitest";
import { SqliteStore } from "../sqlite-store.js";

const sampleFile = (overrides: Partial<Record<string, unknown>> = {}) => ({
  bucket: "tcm-study",
  key: "Biology/Genetics/mendel.pdf",
  size: 1024,
  etag: "abc",
  contentType: null,
  lastModified: "2026-05-12T00:00:00Z",
  indexedAt: "2026-05-12T00:00:00Z",
  ...overrides,
});

describe("SqliteStore", () => {
  it("upserts and retrieves a file", () => {
    const store = SqliteStore.inMemory();
    store.upsertFile(sampleFile() as never);
    const got = store.getFile("tcm-study", "Biology/Genetics/mendel.pdf");
    expect(got?.size).toBe(1024);
    store.close();
  });

  it("updates on conflict", () => {
    const store = SqliteStore.inMemory();
    store.upsertFile(sampleFile() as never);
    store.upsertFile(sampleFile({ size: 2048, etag: "xyz" }) as never);
    const got = store.getFile("tcm-study", "Biology/Genetics/mendel.pdf");
    expect(got?.size).toBe(2048);
    expect(got?.etag).toBe("xyz");
    store.close();
  });

  it("lists by prefix", () => {
    const store = SqliteStore.inMemory();
    store.upsertFile(sampleFile({ key: "Biology/Genetics/mendel.pdf" }) as never);
    store.upsertFile(sampleFile({ key: "Biology/Genetics/dna.pdf" }) as never);
    store.upsertFile(sampleFile({ key: "Chemistry/acids.pdf" }) as never);
    const hits = store.listByPrefix("tcm-study", "Biology/Genetics");
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.key.startsWith("Biology/Genetics/"))).toBe(true);
    store.close();
  });

  it("resolveSource returns exact file for exact key", () => {
    const store = SqliteStore.inMemory();
    store.upsertFile(sampleFile({ key: "single.pdf" }) as never);
    const hits = store.resolveSource("tcm-study", "single.pdf");
    expect(hits).toHaveLength(1);
    expect(hits[0].key).toBe("single.pdf");
    store.close();
  });

  it("FTS find matches by partial keyword", () => {
    const store = SqliteStore.inMemory();
    store.upsertFile(sampleFile({ key: "Biology/Genetics/mendel-laws.pdf" }) as never);
    store.upsertFile(sampleFile({ key: "Biology/Evolution/darwin-summary.pdf" }) as never);
    const hits = store.find("tcm-study", "mendel");
    expect(hits).toHaveLength(1);
    expect(hits[0].key).toContain("mendel");
    store.close();
  });

  it("rebuildFolders computes per-folder counts", () => {
    const store = SqliteStore.inMemory();
    store.upsertFile(sampleFile({ key: "Biology/Genetics/a.pdf", size: 100 }) as never);
    store.upsertFile(sampleFile({ key: "Biology/Genetics/b.pdf", size: 200 }) as never);
    store.upsertFile(sampleFile({ key: "Biology/Evolution/c.pdf", size: 50 }) as never);
    store.rebuildFolders("tcm-study");
    const top = store.listTopFolders("tcm-study");
    const bio = top.find((f) => f.path === "Biology");
    expect(bio?.fileCount).toBe(3);
    expect(bio?.totalBytes).toBe(350);
    const subs = store.listSubFolders("tcm-study", "Biology");
    expect(subs.map((s) => s.path).sort()).toEqual(["Biology/Evolution", "Biology/Genetics"]);
    store.close();
  });

  it("allKeys returns set for deletion diff", () => {
    const store = SqliteStore.inMemory();
    store.upsertFile(sampleFile({ key: "a.pdf" }) as never);
    store.upsertFile(sampleFile({ key: "b.pdf" }) as never);
    const keys = store.allKeys("tcm-study");
    expect(keys.size).toBe(2);
    expect(keys.has("a.pdf")).toBe(true);
    store.close();
  });
});
