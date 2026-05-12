import { describe, it, expect } from "vitest";
import { resolveConfig, expandPath, parseSourceSpec } from "../config.js";

describe("expandPath", () => {
  it("expands ~ to homedir", () => {
    const out = expandPath("~/foo");
    expect(out).toMatch(/\/foo$/);
    expect(out).not.toContain("~");
  });

  it("returns absolute paths unchanged-ish", () => {
    const out = expandPath("/tmp/x");
    expect(out).toBe("/tmp/x");
  });
});

describe("resolveConfig", () => {
  it("loads credentials from env via *Env keys", () => {
    const cfg = resolveConfig(
      {
        endpoint: "https://s3.example.com",
        subjectBuckets: ["biology", "maths"],
      },
      { IDRIVE_E2_ACCESS_KEY: "AK123", IDRIVE_E2_SECRET_KEY: "SK456" }
    );
    expect(cfg.accessKey).toBe("AK123");
    expect(cfg.secretKey).toBe("SK456");
    expect(cfg.subjectBuckets).toEqual(["biology", "maths"]);
  });

  it("subjectBuckets defaults to empty array (auto-discover mode)", () => {
    const cfg = resolveConfig(
      { endpoint: "https://s3.example.com" },
      { IDRIVE_E2_ACCESS_KEY: "x", IDRIVE_E2_SECRET_KEY: "y" }
    );
    expect(cfg.subjectBuckets).toEqual([]);
  });

  it("respects custom *Env key names", () => {
    const cfg = resolveConfig(
      {
        endpoint: "https://s3.example.com",
        accessKeyEnv: "MY_AK",
        secretKeyEnv: "MY_SK",
      },
      { MY_AK: "ak", MY_SK: "sk" }
    );
    expect(cfg.accessKey).toBe("ak");
  });

  it("throws when credentials missing", () => {
    expect(() => resolveConfig({ endpoint: "https://s3.example.com" }, {})).toThrow(
      /missing credentials/
    );
  });

  it("uses defaults when config object is empty", () => {
    const cfg = resolveConfig(
      {},
      { IDRIVE_E2_ACCESS_KEY: "x", IDRIVE_E2_SECRET_KEY: "y" }
    );
    expect(cfg.endpoint).toBe("https://s3.ap-northeast-1.idrivee2.com");
    expect(cfg.region).toBe("ap-northeast-1");
  });

  it("auto-loads credentials from <dataDir>/.env when not in env", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "tcm-cfg-"));
    writeFileSync(
      join(dir, ".env"),
      "IDRIVE_E2_ACCESS_KEY=from_file\nIDRIVE_E2_SECRET_KEY=from_file_sk\n",
      "utf8"
    );
    const cfg = resolveConfig({ dataDir: dir }, {});
    expect(cfg.accessKey).toBe("from_file");
    expect(cfg.secretKey).toBe("from_file_sk");
  });
});

describe("parseSourceSpec", () => {
  it("returns bucket-only when no slash", () => {
    expect(parseSourceSpec("biology")).toEqual({ bucket: "biology", key: "" });
  });
  it("splits on first slash", () => {
    expect(parseSourceSpec("biology/Genetics")).toEqual({ bucket: "biology", key: "Genetics" });
  });
  it("preserves nested key paths", () => {
    expect(parseSourceSpec("biology/Genetics/mendel.pdf")).toEqual({
      bucket: "biology",
      key: "Genetics/mendel.pdf",
    });
  });
});
