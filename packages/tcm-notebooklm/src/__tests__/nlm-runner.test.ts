import { describe, it, expect } from "vitest";
import {
  isRateLimited,
  looseParseJson,
  unwrapQueryAnswer,
  parseNotebookId,
} from "../nlm-runner.js";

describe("isRateLimited", () => {
  it("detects 429 in output", () => {
    expect(isRateLimited("Error: HTTP 429 Too Many Requests")).toBe(true);
  });
  it("detects quota exceeded text", () => {
    expect(isRateLimited("Daily quota exceeded for this user")).toBe(true);
  });
  it("detects rate limit text", () => {
    expect(isRateLimited("rate limit reached")).toBe(true);
  });
  it("returns false for normal output", () => {
    expect(isRateLimited("✓ Created notebook: My Notebook\nID: abc-123")).toBe(false);
  });
});

describe("looseParseJson", () => {
  it("parses clean JSON", () => {
    expect(looseParseJson('{"a": 1}')).toEqual({ a: 1 });
  });
  it("parses JSON after banner lines", () => {
    const text = "Welcome to nlm v0.1.0\nQuerying...\n{\"answer\": \"yes\"}";
    expect(looseParseJson(text)).toEqual({ answer: "yes" });
  });
  it("parses array JSON", () => {
    expect(looseParseJson("output:\n[1, 2, 3]")).toEqual([1, 2, 3]);
  });
  it("handles nested objects with quoted braces", () => {
    const text = 'pre {"a": "has {brace} in string", "b": {"c": 2}} post';
    expect(looseParseJson(text)).toEqual({ a: "has {brace} in string", b: { c: 2 } });
  });
  it("throws when no JSON present", () => {
    expect(() => looseParseJson("just text, no json here")).toThrow();
  });
});

describe("unwrapQueryAnswer", () => {
  it("unwraps {value: {answer}} shape", () => {
    const out = unwrapQueryAnswer({ value: { answer: "hello", references: [] } });
    expect(out.answer).toBe("hello");
    expect(out.references).toEqual([]);
  });
  it("falls back to flat answer", () => {
    const out = unwrapQueryAnswer({ answer: "flat" });
    expect(out.answer).toBe("flat");
  });
  it("includes references when present", () => {
    const out = unwrapQueryAnswer({
      value: { answer: "x", references: [{ source_id: "s1", cited_text: "..." }] },
    });
    expect(out.references).toHaveLength(1);
  });
});

describe("parseNotebookId", () => {
  it("extracts ID from create output", () => {
    expect(parseNotebookId("✓ Created notebook: My NB\nID: abc-123-xyz")).toBe("abc-123-xyz");
  });
  it("handles 'Notebook ID:' prefix", () => {
    expect(parseNotebookId("Notebook ID: nb_abc")).toBe("nb_abc");
  });
  it("returns null when no ID found", () => {
    expect(parseNotebookId("no such thing here")).toBeNull();
  });
});
