import { describe, it, expect } from "vitest";
import { writeCsv, csvField } from "../csv-writer.js";
import type { MCQ } from "@tcm/shared";

describe("csvField", () => {
  it("returns plain strings unchanged", () => {
    expect(csvField("hello")).toBe("hello");
  });
  it("quotes fields with commas", () => {
    expect(csvField("a, b")).toBe('"a, b"');
  });
  it("escapes inner quotes", () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });
  it("quotes fields with newlines", () => {
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("writeCsv", () => {
  const mcq: MCQ = {
    question: "What is 2+2?",
    options: { A: "3", B: "4", C: "5", D: "6" },
    correct: "B",
    explanation: "basic",
    sourceKey: "math/basics.pdf",
  };

  it("emits header + one row", () => {
    const out = writeCsv([mcq]);
    const lines = out.trim().split("\n");
    expect(lines[0]).toBe("question,A,B,C,D,correct,explanation,source_key");
    expect(lines[1]).toBe("What is 2+2?,3,4,5,6,B,basic,math/basics.pdf");
  });

  it("respects custom headers", () => {
    const out = writeCsv([mcq], ["question", "correct"]);
    expect(out.trim().split("\n")[0]).toBe("question,correct");
  });

  it("escapes questions with commas", () => {
    const m: MCQ = { ...mcq, question: "What, exactly?" };
    const out = writeCsv([m]);
    expect(out).toContain('"What, exactly?"');
  });
});
