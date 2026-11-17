import { extractJsonObjects } from "./judge";
import type { Job, Row } from "./types";

export interface SuggestRequest {
  jobName: string;
  reader: string;
  tests: string;
  asks: string;
  records: Row["records"];
}

export interface SuggestedChecks {
  mustSay: string[];
  mustShow: string[];
  mustNot: string[];
  ifUnsure: string[];
  allowed: string[];
}

export const SUGGEST_FIELDS = ["mustSay", "mustShow", "mustNot", "ifUnsure", "allowed"] as const;

export function suggestRequestFor(job: Job, row: Row): SuggestRequest {
  return { jobName: job.name, reader: job.reader, tests: row.tests, asks: row.asks, records: row.records };
}

export function buildSuggestPrompt(r: SuggestRequest): string {
  const recs = r.records.length
    ? r.records.map((x) => `[${x.id}] ${x.label}\n${x.text || "(no text saved)"}`).join("\n\n")
    : "(no records saved)";
  return [
    "You are helping write one golden test case for evaluating an AI assistant. A person will review what you write.",
    `JOB: ${r.jobName}\nWHO READS THE ANSWER: ${r.reader || "not stated"}\nWHAT THIS CASE TESTS: ${r.tests || "not stated"}`,
    `THE USER ASKED\n${r.asks}\n\nRECORDS (the only facts that exist for this case)\n${recs}`,
    [
      "Write the yes or no checks a grader will use on any answer to this case. Use only facts in the records. Each item is one short line, under 18 words, with no numbering.",
      "- mustSay: 2 to 4 checkable facts a correct answer must state.",
      "- mustShow: 1 to 3 records the answer must point to, each ending with its record id in brackets, like (R2).",
      "- mustNot: 2 to 3 tempting mistakes specific to this case, such as inventing a fact the records lack or using a superseded record.",
      "- ifUnsure: 1 rule for what the records cannot settle, written as a rule the answer should follow.",
      "- allowed: 1 or 2 rules on what the assistant may read or do to get the answer.",
    ].join("\n"),
    'Return JSON only, in this shape: {"mustSay":[],"mustShow":[],"mustNot":[],"ifUnsure":[],"allowed":[]}',
  ].join("\n\n");
}

export function parseSuggestion(text: string): SuggestedChecks | null {
  for (const obj of extractJsonObjects(text)) {
    if (!obj || typeof obj !== "object") continue;
    const o = obj as Record<string, unknown>;
    const out = {} as SuggestedChecks;
    let n = 0;
    for (const f of SUGGEST_FIELDS) {
      const v = o[f];
      out[f] = Array.isArray(v) ? v.map((x) => String(x).replace(/\s+/g, " ").trim()).filter(Boolean) : [];
      n += out[f].length;
    }
    if (n) return out;
  }
  return null;
}
