import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEnvFile, mergeEnvFromFile } from "../env-file.js";

function writeTmpEnv(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "tcm-env-"));
  writeFileSync(join(dir, ".env"), body, "utf8");
  return dir;
}

describe("readEnvFile", () => {
  it("returns empty object for missing file", () => {
    expect(readEnvFile("/nope/does/not/exist/.env")).toEqual({});
  });

  it("parses KEY=value pairs", () => {
    const dir = writeTmpEnv("IDRIVE_E2_ACCESS_KEY=ak\nIDRIVE_E2_SECRET_KEY=sk\n");
    expect(readEnvFile(join(dir, ".env"))).toEqual({
      IDRIVE_E2_ACCESS_KEY: "ak",
      IDRIVE_E2_SECRET_KEY: "sk",
    });
  });

  it("strips matching quotes", () => {
    const dir = writeTmpEnv(`KEY1="quoted"\nKEY2='single'\n`);
    expect(readEnvFile(join(dir, ".env"))).toEqual({
      KEY1: "quoted",
      KEY2: "single",
    });
  });

  it("skips comments and blank lines", () => {
    const dir = writeTmpEnv("# a comment\n\nKEY=val\n#another\n");
    expect(readEnvFile(join(dir, ".env"))).toEqual({ KEY: "val" });
  });

  it("ignores lowercased / invalid keys", () => {
    const dir = writeTmpEnv("badkey=x\nGOOD_KEY=y\n123=z\n");
    expect(readEnvFile(join(dir, ".env"))).toEqual({ GOOD_KEY: "y" });
  });
});

describe("mergeEnvFromFile", () => {
  it("returns file values when process env is empty", () => {
    const dir = writeTmpEnv("IDRIVE_E2_ACCESS_KEY=from_file\n");
    const merged = mergeEnvFromFile(dir, {});
    expect(merged.IDRIVE_E2_ACCESS_KEY).toBe("from_file");
  });

  it("process env wins over file", () => {
    const dir = writeTmpEnv("IDRIVE_E2_ACCESS_KEY=from_file\n");
    const merged = mergeEnvFromFile(dir, { IDRIVE_E2_ACCESS_KEY: "from_proc" });
    expect(merged.IDRIVE_E2_ACCESS_KEY).toBe("from_proc");
  });

  it("returns process env unchanged when file missing", () => {
    const merged = mergeEnvFromFile("/no/such/dir", { ONLY_PROC: "yes" });
    expect(merged.ONLY_PROC).toBe("yes");
  });
});
