import type { MCQ } from "@tcm/shared";

const DEFAULT_HEADERS = [
  "question",
  "A",
  "B",
  "C",
  "D",
  "correct",
  "explanation",
  "source_key",
];

export function writeCsv(mcqs: MCQ[], headers: string[] = DEFAULT_HEADERS): string {
  const lines: string[] = [headers.join(",")];
  for (const m of mcqs) {
    const row = headers.map((h) => csvField(getField(m, h)));
    lines.push(row.join(","));
  }
  return lines.join("\n") + "\n";
}

function getField(m: MCQ, header: string): string {
  switch (header) {
    case "question":
      return m.question;
    case "A":
      return m.options.A;
    case "B":
      return m.options.B;
    case "C":
      return m.options.C;
    case "D":
      return m.options.D;
    case "correct":
      return m.correct;
    case "explanation":
      return m.explanation ?? "";
    case "source_key":
      return m.sourceKey ?? "";
    default:
      return "";
  }
}

/** RFC 4180 escaping. */
export function csvField(value: string): string {
  if (value === undefined || value === null) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
