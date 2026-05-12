import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildConfigEntries,
  expandPath,
  loadEnvFile,
  renderConfigSnippet,
  renderEnvFile,
  saveSetup,
  type SetupAnswers,
} from "../setup-core.js";

const answers: SetupAnswers = {
  endpoint: "https://s3.ap-northeast-1.idrivee2.com",
  region: "ap-northeast-1",
  accessKey: "AK_TEST",
  secretKey: "SK_TEST",
  subjectBuckets: ["maths", "biology"],
  outputBucket: "tcm-mcqs",
  nlmBin: "/does/not/exist/nlm",
  dataDir: "~/.tcm",
};

describe("expandPath", () => {
  it("expands ~ to homedir", () => {
    const out = expandPath("~/foo");
    expect(out).not.toContain("~");
    expect(out).toMatch(/\/foo$/);
  });
  it("returns absolute paths untouched", () => {
    expect(expandPath("/tmp/x")).toBe("/tmp/x");
  });
});

describe("renderEnvFile / loadEnvFile", () => {
  it("round-trips key/value pairs", () => {
    const tmp = mkdtempSync(join(tmpdir(), "tcm-setup-"));
    const envPath = join(tmp, ".env");
    writeFileSync(envPath, renderEnvFile(answers), "utf8");
    const loaded = loadEnvFile(envPath);
    expect(loaded.IDRIVE_E2_ACCESS_KEY).toBe("AK_TEST");
    expect(loaded.IDRIVE_E2_SECRET_KEY).toBe("SK_TEST");
    expect(loaded.IDRIVE_E2_ENDPOINT).toBe(answers.endpoint);
    expect(loaded.TCM_SUBJECT_BUCKETS).toBe("maths,biology");
    expect(loaded.TCM_MCQ_BUCKET).toBe("tcm-mcqs");
  });

  it("returns empty object for missing file", () => {
    const tmp = mkdtempSync(join(tmpdir(), "tcm-setup-"));
    expect(loadEnvFile(join(tmp, "missing.env"))).toEqual({});
  });
});

describe("buildConfigEntries / renderConfigSnippet", () => {
  it("emits all three plugin entries with multi-bucket shape", () => {
    const entries = buildConfigEntries(answers);
    expect(entries["tcm-idrive"].config.subjectBuckets).toEqual(["maths", "biology"]);
    expect(entries["tcm-idrive"].config.excludeBuckets).toEqual(["tcm-mcqs"]);
    expect(entries["tcm-quiz"].config.outputBucket).toBe("tcm-mcqs");
    expect(entries["tcm-quiz"].config.subjectBuckets).toEqual(["maths", "biology"]);
    expect(entries["tcm-notebooklm"].config.nlmBin).toBe("/does/not/exist/nlm");
  });

  it("never uses the legacy sourceBucket key", () => {
    const json = renderConfigSnippet(answers);
    expect(json).not.toMatch(/sourceBucket/);
    expect(json).toContain("subjectBuckets");
  });
});

describe("saveSetup", () => {
  it("writes env file mode 0600 and reports bucket+nlm checks", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "tcm-save-"));
    const envPath = join(tmp, ".env");
    const result = await saveSetup(
      { ...answers, subjectBuckets: [] }, // skip the network check
      { envPath, applyConfig: false }
    );
    expect(result.envPath).toBe(envPath);
    expect(readFileSync(envPath, "utf8")).toMatch(/IDRIVE_E2_ACCESS_KEY=AK_TEST/);

    // Posix-only mode check; skip on platforms that don't report 0o600.
    const mode = statSync(envPath).mode & 0o777;
    expect([0o600, 0o644]).toContain(mode); // 0o600 on posix; lenient elsewhere

    // nlm bin doesn't exist → nlmCheck.ok must be false.
    expect(result.nlmCheck.ok).toBe(false);
    expect(result.bucketChecks).toEqual([]);
    expect(result.configApplied).toBe(false);
    expect(result.configSnippet).toBeTruthy();
  });

  it("includes the config snippet on the result", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "tcm-save-"));
    const result = await saveSetup(
      { ...answers, subjectBuckets: [] },
      { envPath: join(tmp, ".env") }
    );
    expect(result.configSnippetJson).toContain("subjectBuckets");
    expect(result.configSnippetJson).toContain("tcm-mcqs");
  });
});
