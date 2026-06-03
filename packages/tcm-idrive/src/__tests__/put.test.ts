import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sent: any[] = [];
let existing = new Set<string>();

vi.mock("../s3-client.js", async () => {
  const actual = await vi.importActual<any>("../s3-client.js");
  return {
    ...actual,
    uploadFile: vi.fn(async (_c: unknown, bucket: string, key: string, srcPath: string, ct: string) => {
      sent.push({ bucket, key, srcPath, ct });
    }),
    objectExists: vi.fn(async (_c: unknown, bucket: string, key: string) => existing.has(`${bucket}/${key}`)),
  };
});

import { runPut, guessContentType } from "../cli/put.js";
import type { ResolvedIdriveConfig } from "../config.js";

function cfg(): ResolvedIdriveConfig {
  return {
    endpoint: "https://s3.example.com", region: "ap-northeast-1",
    subjectBuckets: [], excludeBuckets: [],
    accessKeyEnv: "IDRIVE_E2_ACCESS_KEY", secretKeyEnv: "IDRIVE_E2_SECRET_KEY",
    dataDir: "~/.tcm", memoryDir: "", resolvedDataDir: "/tmp/.tcm",
    accessKey: "AK", secretKey: "SK",
  };
}

describe("guessContentType", () => {
  it("maps known extensions, case-insensitively", () => {
    expect(guessContentType("x.csv")).toBe("text/csv");
    expect(guessContentType("x.PDF")).toBe("application/pdf");
  });
  it("falls back to octet-stream", () => {
    expect(guessContentType("x.bin")).toBe("application/octet-stream");
    expect(guessContentType("noext")).toBe("application/octet-stream");
  });
});

describe("runPut", () => {
  let file: string;
  beforeEach(() => {
    sent.length = 0;
    existing = new Set();
    const dir = mkdtempSync(join(tmpdir(), "put-test-"));
    file = join(dir, "result.csv");
    writeFileSync(file, "a,b\n1,2\n");
  });

  it("uploads bucket-only spec using filename as key, inferring content type", async () => {
    await runPut({ cfg: cfg(), client: {} as any, spec: "physics", file });
    expect(sent).toEqual([
      { bucket: "physics", key: "result.csv", srcPath: file, ct: "text/csv" },
    ]);
  });

  it("uploads into any caller-chosen subject bucket (no bucket-type guard)", async () => {
    await runPut({ cfg: cfg(), client: {} as any, spec: "biology/ch1/notes.csv", file });
    expect(sent[0]).toMatchObject({ bucket: "biology", key: "ch1/notes.csv" });
  });

  it("honors explicit content-type override", async () => {
    await runPut({ cfg: cfg(), client: {} as any, spec: "maths/out.dat", file, contentType: "application/x-custom" });
    expect(sent[0]).toMatchObject({ key: "out.dat", ct: "application/x-custom" });
  });

  it("refuses to clobber an existing object without --overwrite", async () => {
    existing.add("physics/result.csv");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
    await expect(runPut({ cfg: cfg(), client: {} as any, spec: "physics/result.csv", file })).rejects.toThrow("exit");
    expect(sent).toHaveLength(0);
    exit.mockRestore();
  });

  it("overwrites an existing object when --overwrite is set", async () => {
    existing.add("physics/result.csv");
    await runPut({ cfg: cfg(), client: {} as any, spec: "physics/result.csv", file, overwrite: true });
    expect(sent[0]).toMatchObject({ bucket: "physics", key: "result.csv" });
  });
});
