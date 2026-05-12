import { describe, it, expect } from "vitest";
import { resolveConfig, expandPath } from "../config.js";

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
        sourceBucket: "tcm-study",
      },
      { IDRIVE_E2_ACCESS_KEY: "AK123", IDRIVE_E2_SECRET_KEY: "SK456" }
    );
    expect(cfg.accessKey).toBe("AK123");
    expect(cfg.secretKey).toBe("SK456");
    expect(cfg.region).toBe("us-east-1");
  });

  it("respects custom *Env key names", () => {
    const cfg = resolveConfig(
      {
        endpoint: "https://s3.example.com",
        sourceBucket: "x",
        accessKeyEnv: "MY_AK",
        secretKeyEnv: "MY_SK",
      },
      { MY_AK: "ak", MY_SK: "sk" }
    );
    expect(cfg.accessKey).toBe("ak");
  });

  it("throws when credentials missing", () => {
    expect(() =>
      resolveConfig({ endpoint: "https://s3.example.com", sourceBucket: "x" }, {})
    ).toThrow(/missing credentials/);
  });

  it("rejects missing required fields", () => {
    expect(() =>
      resolveConfig({}, { IDRIVE_E2_ACCESS_KEY: "x", IDRIVE_E2_SECRET_KEY: "y" })
    ).toThrow();
  });
});
