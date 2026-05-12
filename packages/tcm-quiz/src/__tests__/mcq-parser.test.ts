import { describe, it, expect } from "vitest";
import { parseMcqArray, dedupeMcqs } from "../mcq-parser.js";

const validMcq = {
  question: "What is 2+2?",
  options: { A: "3", B: "4", C: "5", D: "6" },
  correct: "B",
  explanation: "basic math",
};

describe("parseMcqArray", () => {
  it("parses a clean JSON array", () => {
    const text = JSON.stringify([validMcq]);
    const out = parseMcqArray(text);
    expect(out).toHaveLength(1);
    expect(out[0].correct).toBe("B");
  });

  it("parses array embedded in prose", () => {
    const text = `Here are your questions:\n${JSON.stringify([validMcq, { ...validMcq, question: "Q2" }])}\nGood luck!`;
    const out = parseMcqArray(text);
    expect(out).toHaveLength(2);
  });

  it("handles options as array form", () => {
    const text = JSON.stringify([
      { question: "Q?", options: ["a", "b", "c", "d"], correct: "A", explanation: "" },
    ]);
    const out = parseMcqArray(text);
    expect(out).toHaveLength(1);
    expect(out[0].options.A).toBe("a");
    expect(out[0].options.D).toBe("d");
  });

  it("accepts 'answer' as an alias for 'correct'", () => {
    const text = JSON.stringify([
      { question: "Q?", options: { A: "a", B: "b", C: "c", D: "d" }, answer: "C", explanation: "" },
    ]);
    const out = parseMcqArray(text);
    expect(out).toHaveLength(1);
    expect(out[0].correct).toBe("C");
  });

  it("skips invalid entries but keeps valid ones", () => {
    const text = JSON.stringify([validMcq, { broken: true }, { ...validMcq, question: "Q3" }]);
    const out = parseMcqArray(text);
    expect(out).toHaveLength(2);
  });

  it("returns empty when no JSON array present", () => {
    expect(parseMcqArray("no json here at all")).toEqual([]);
  });

  it("returns empty when array exists but no entries validate", () => {
    expect(parseMcqArray('[{"foo": "bar"}]')).toEqual([]);
  });
});

describe("dedupeMcqs", () => {
  it("dedupes by question stem", () => {
    const a = { ...validMcq, question: "What is 2+2?" };
    const b = { ...validMcq, question: "What is 2+2?" };
    const c = { ...validMcq, question: "What is 3+3?" };
    const out = dedupeMcqs([a as never, b as never, c as never]);
    expect(out).toHaveLength(2);
  });

  it("treats different questions as distinct", () => {
    const a = { ...validMcq, question: "What is 2+2?" };
    const b = { ...validMcq, question: "What is 3+3?" };
    const out = dedupeMcqs([a as never, b as never]);
    expect(out).toHaveLength(2);
  });
});
