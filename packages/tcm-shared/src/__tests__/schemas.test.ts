import { describe, it, expect } from "vitest";
import { FileRecord, MCQ, Job, slugify, newJobId, MCQGenerateRequest } from "../index.js";

describe("FileRecord", () => {
  it("parses a valid record", () => {
    const parsed = FileRecord.parse({
      bucket: "tcm-study",
      key: "Biology/Genetics/mendel.pdf",
      size: 1024,
      etag: "abc",
      contentType: "application/pdf",
      lastModified: "2026-05-12T00:00:00Z",
      indexedAt: "2026-05-12T00:00:00Z",
    });
    expect(parsed.size).toBe(1024);
  });

  it("rejects negative size", () => {
    expect(() =>
      FileRecord.parse({
        bucket: "x",
        key: "y",
        size: -1,
        etag: "",
        contentType: null,
        lastModified: "",
        indexedAt: "",
      })
    ).toThrow();
  });
});

describe("MCQ", () => {
  it("parses a complete MCQ", () => {
    const mcq = MCQ.parse({
      question: "Q?",
      options: { A: "a", B: "b", C: "c", D: "d" },
      correct: "B",
      explanation: "because",
    });
    expect(mcq.correct).toBe("B");
  });

  it("rejects invalid correct value", () => {
    expect(() =>
      MCQ.parse({
        question: "Q",
        options: { A: "a", B: "b", C: "c", D: "d" },
        correct: "E",
      })
    ).toThrow();
  });
});

describe("Job", () => {
  it("applies defaults", () => {
    const job = Job.parse({
      id: "j-abc123",
      status: "running",
      sourceSpec: "Biology/Genetics",
      sourceKeys: ["a", "b"],
      startedAt: "2026-05-12T00:00:00Z",
    });
    expect(job.count).toBe(0);
    expect(job.difficulty).toBe("medium");
    expect(job.outputBucket).toBeNull();
  });
});

describe("MCQGenerateRequest", () => {
  it("clamps count and applies defaults", () => {
    const req = MCQGenerateRequest.parse({ source: "Biology" });
    expect(req.count).toBe(20);
    expect(req.difficulty).toBe("medium");
  });

  it("rejects count over 50", () => {
    expect(() => MCQGenerateRequest.parse({ source: "x", count: 100 })).toThrow();
  });
});

describe("slugify", () => {
  it("converts paths to slugs", () => {
    expect(slugify("Biology/Genetics")).toBe("biology-genetics");
    expect(slugify("Hello, World!")).toBe("hello-world");
  });

  it("caps at 60 chars", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(60);
  });
});

describe("newJobId", () => {
  it("produces j- prefix", () => {
    expect(newJobId()).toMatch(/^j-[a-z0-9]{6}$/);
  });
});
