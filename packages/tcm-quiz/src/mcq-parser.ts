import { MCQ } from "@tcm/shared";
import type { MCQ as MCQType } from "@tcm/shared";

/**
 * Parse a NotebookLM response into MCQ records. The LLM is asked to return a
 * JSON array; in practice we get JSON sometimes wrapped in prose. Strategy:
 * find the largest valid JSON array embedded in the text, then validate each
 * entry against the MCQ schema.
 */
export function parseMcqArray(text: string): MCQType[] {
  const candidates = findJsonArrays(text);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed)) continue;
      const mcqs: MCQType[] = [];
      for (const raw of parsed) {
        const normalized = normalize(raw);
        if (!normalized) continue;
        const result = MCQ.safeParse(normalized);
        if (result.success) mcqs.push(result.data);
      }
      if (mcqs.length > 0) return mcqs;
    } catch {
      // try next
    }
  }
  return [];
}

function normalize(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  let options = r.options;
  // Accept both { options: {A, B, C, D} } and { options: ["a", "b", "c", "d"] }
  if (Array.isArray(options) && options.length >= 4) {
    options = {
      A: String(options[0]),
      B: String(options[1]),
      C: String(options[2]),
      D: String(options[3]),
    };
  }
  // Some LLMs emit "answer" instead of "correct"
  const correct = (r.correct ?? r.answer) as unknown;
  return {
    question: r.question,
    options,
    correct,
    explanation: r.explanation ?? "",
  };
}

function findJsonArrays(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "[") continue;
    const end = matchingClose(text, i);
    if (end !== -1) out.push(text.slice(i, end + 1));
  }
  return out.sort((a, b) => b.length - a.length);
}

function matchingClose(s: string, openIdx: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Deduplicate MCQs by the first 80 chars of their question (lowercased). */
export function dedupeMcqs(mcqs: MCQType[]): MCQType[] {
  const seen = new Set<string>();
  const out: MCQType[] = [];
  for (const m of mcqs) {
    const key = m.question.toLowerCase().slice(0, 80).trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}
