import { DIM_BY_KEY, dimLabel, GROUP_INFO } from "./dims";
import { grade, groupLines, handDims, type GradeResult, type Marks } from "./scoring";
import { GROUPS, SCALE, type Answer, type DimKey, type Group, type Job, type Row, type Score } from "./types";

/** Groups the judge answers. A (allowed ways) and the automatic failures are code checks. */
export const JUDGE_GROUPS: readonly Group[] = GROUPS.filter((g) => !GROUP_INFO[g].code);

export interface JudgeCall {
  kind: "checks" | "score";
  dim?: DimKey;
  title: string;
  prompt: string;
}

function caseBlock(row: Row): string {
  const recs = row.records.length
    ? row.records.map((r) => `[${r.id}] ${r.label}\n${r.text || "(no text saved)"}`).join("\n\n")
    : "(no records saved)";
  return `THE USER ASKED\n${row.asks || "(no question saved)"}\n\nRECORDS (the only facts that exist for this case)\n${recs}`;
}

function answerBlock(a: Answer): string {
  return `ANSWER\n${a.answer || "(empty answer)"}\n\nACTION LOG\n${a.log || "(none)"}`;
}

/** The yes/no checks the judge sees, numbered by position within each group (S1, S2, N1...). */
function checkList(row: Row): string {
  return JUDGE_GROUPS.map((g) => {
    const ls = groupLines(row, g);
    if (!ls.length) return "";
    return `${GROUP_INFO[g].title.toUpperCase()}: ${GROUP_INFO[g].question}\n${ls
      .map((l, i) => `${g}${i + 1}. ${l.text}`)
      .join("\n")}`;
  })
    .filter(Boolean)
    .join("\n\n");
}

function checksShape(row: Row, a?: Answer): string {
  const o: Record<string, { why: string; yes: boolean }> = {};
  for (const g of JUDGE_GROUPS)
    groupLines(row, g).forEach((l, i) => {
      o[`${g}${i + 1}`] = { why: a ? "(reason quoting the answer)" : "", yes: a ? a.checks[g]?.[l.id] === true : true };
    });
  return JSON.stringify({ checks: o });
}

function hasJudgeChecks(row: Row): boolean {
  return JUDGE_GROUPS.some((g) => groupLines(row, g).length > 0);
}

function allJudgeChecksAnswered(row: Row, a: Answer): boolean {
  return JUDGE_GROUPS.every((g) => groupLines(row, g).every((l) => typeof a.checks[g]?.[l.id] === "boolean"));
}

/** Worked examples: Tuning answers on OTHER rows only. Holdout answers never enter a prompt. */
export function exampleCandidates(job: Job, row: Row): { row: Row; answer: Answer }[] {
  const out: { row: Row; answer: Answer }[] = [];
  for (const r of job.rows) {
    if (r.id === row.id) continue;
    for (const a of r.answers) if (a.set === "Tuning" && a.answer.trim()) out.push({ row: r, answer: a });
  }
  return out;
}

/**
 * One call for all yes/no checks except group A, plus one call per hand-scored
 * dimension. Prompts never mention weights or the pass mark.
 */
export function buildJudgeCalls(job: Job, row: Row, a: Answer): JudgeCall[] {
  const calls: JudgeCall[] = [];
  const examples = exampleCandidates(job, row);

  if (hasJudgeChecks(row)) {
    const ex = examples.find((e) => hasJudgeChecks(e.row) && allJudgeChecksAnswered(e.row, e.answer));
    const parts = [
      "You are checking one answer from an AI assistant against a test case. Use only the records below. Do not use outside knowledge. Do not give a score or an overall verdict.",
      caseBlock(row),
      `CHECKS\nFor each check, write the reason first, quoting the answer, then yes or no.\n\n${checkList(row)}`,
    ];
    if (ex)
      parts.push(
        `WORKED EXAMPLE FROM ANOTHER CASE\n${caseBlock(ex.row)}\n\n${checkList(ex.row)}\n\n${answerBlock(ex.answer)}\n\nCorrect output: ${checksShape(ex.row, ex.answer)}`,
      );
    parts.push(`RETURN JSON ONLY, in this shape\n${checksShape(row)}`, `NOW CHECK THIS ONE\n${answerBlock(a)}`);
    calls.push({ kind: "checks", title: "Yes or no checks", prompt: parts.join("\n\n") + "\n" });
  }

  for (const key of handDims(job, row)) {
    const d = job.dims[key];
    const label = dimLabel(key, d.plainName);
    const exs = examples
      .filter((e) => handDims(job, e.row).includes(key) && e.answer.scores[key] !== undefined)
      .slice(0, 2);
    const shape = JSON.stringify({ scores: { [key]: { why: "", score: 0 } } });
    const parts = [
      "You are scoring one quality of one answer from an AI assistant. Score only this quality and ignore everything else about the answer. Use only the records below.",
      `QUALITY: ${label}\n${DIM_BY_KEY[key].question}\n\nSCALE (use only 0, 3 or 5)\n0 = ${d.s0 || "not described"}\n3 = ${d.s3 || "not described"}\n5 = ${d.s5 || "not described"}`,
      caseBlock(row),
    ];
    if (exs.length)
      parts.push(
        `EXAMPLES GRADED BY A PERSON (from other cases)\n${exs
          .map(
            (e) =>
              `Question: ${e.row.asks}\nAnswer: ${e.answer.answer}\nReason: ${e.answer.why[key] || "(none written)"}\nScore: ${e.answer.scores[key]}`,
          )
          .join("\n\n")}`,
      );
    parts.push(
      `Write the reason first, quoting the answer, then the score.\n\nRETURN JSON ONLY, in this shape\n${shape}`,
      `NOW SCORE THIS ONE\n${answerBlock(a)}`,
    );
    calls.push({ kind: "score", dim: key, title: label, prompt: parts.join("\n\n") + "\n" });
  }
  return calls;
}

/* ---------------- tolerant parsing ---------------- */

/** Every balanced top-level {...} in the text that parses as JSON. Skips prose and code fences. */
export function extractJsonObjects(text: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"' && depth > 0) inStr = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}" && depth > 0) {
      depth--;
      if (depth === 0) {
        try {
          out.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          /* skip malformed object */
        }
      }
    }
  }
  return out;
}

function toBool(v: unknown): boolean | undefined {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    v = o.yes ?? o.answer ?? o.value;
  }
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "yes" || s === "true" || s === "y") return true;
    if (s === "no" || s === "false" || s === "n") return false;
  }
  return undefined;
}

function toScore(v: unknown): number | undefined {
  if (v && typeof v === "object") v = (v as Record<string, unknown>).score;
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export interface ParsedJudge {
  /** Keyed by position id, e.g. { S: { 0: true } } for S1. */
  checks: Record<Group, Record<number, boolean>>;
  scores: Partial<Record<DimKey, Score>>;
  warnings: string[];
  ok: boolean;
}

export function parseJudgeOutput(text: string): ParsedJudge {
  const out: ParsedJudge = { checks: { S: {}, W: {}, N: {}, U: {}, A: {} }, scores: {}, warnings: [], ok: false };
  for (const obj of extractJsonObjects(text)) {
    if (!obj || typeof obj !== "object") continue;
    const o = obj as Record<string, unknown>;
    const checks = (o.checks ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(checks)) {
      const m = /^\s*([SWNU])\s*-?\s*(\d+)\s*$/i.exec(k);
      if (!m) continue;
      const b = toBool(v);
      if (b === undefined) {
        out.warnings.push(`${k.trim()}: no yes/no`);
        continue;
      }
      out.checks[m[1].toUpperCase() as Group][Number(m[2]) - 1] = b;
      out.ok = true;
    }
    const scores = (o.scores ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(scores)) {
      const key = k.trim().toLowerCase() as DimKey;
      if (!(key in DIM_BY_KEY)) continue;
      const n = toScore(v);
      if (n === undefined) continue;
      if (!(SCALE as readonly number[]).includes(n)) {
        out.warnings.push(`${key}: score ${n} is not 0, 3 or 5`);
        continue;
      }
      out.scores[key] = n as Score;
      out.ok = true;
    }
  }
  return out;
}

/**
 * Turn a judge run into Marks for grade(). The judge's S/W/N/U are mapped from
 * position to line id on the current row; A ticks and automatic failures come
 * from the person, because they are code checks.
 */
export function judgeMarks(row: Row, human: Answer, parsed: ParsedJudge): Marks {
  const checks: Marks["checks"] = { S: {}, W: {}, N: {}, U: {}, A: { ...human.checks.A } };
  for (const g of JUDGE_GROUPS)
    groupLines(row, g).forEach((l, i) => {
      const v = parsed.checks[g][i];
      if (v !== undefined) checks[g][l.id] = v;
    });
  return { auto: { ...human.auto }, checks, scores: { ...parsed.scores } };
}

export interface Difference {
  id: string; // "S2" or dimension label
  text: string;
  human: string;
  judge: string;
}

export interface JudgeRunResult {
  empty: boolean;
  /** Text was present but nothing usable was parsed. */
  unreadable: boolean;
  parsed?: ParsedJudge;
  grade?: GradeResult;
  diffs: Difference[];
  /** Items both the human and this run answered (for single-check agreement). */
  compared: number;
}

const yn = (v: boolean | undefined) => (v === true ? "Yes" : v === false ? "No" : "no answer");

export function evaluateRun(job: Job, row: Row, a: Answer, text: string): JudgeRunResult {
  if (!text.trim()) return { empty: true, unreadable: false, diffs: [], compared: 0 };
  const parsed = parseJudgeOutput(text);
  if (!parsed.ok) return { empty: false, unreadable: true, parsed, diffs: [], compared: 0 };
  const marks = judgeMarks(row, a, parsed);
  const g = grade(job, row, marks);
  const diffs: Difference[] = [];
  let compared = 0;
  for (const grp of JUDGE_GROUPS)
    groupLines(row, grp).forEach((l, i) => {
      const h = a.checks[grp]?.[l.id];
      if (typeof h !== "boolean") return;
      compared++;
      const j = marks.checks[grp][l.id];
      if (h !== j) diffs.push({ id: `${grp}${i + 1}`, text: l.text, human: yn(h), judge: yn(j) });
    });
  for (const key of handDims(job, row)) {
    const h = a.scores[key];
    if (h === undefined) continue;
    compared++;
    const j = marks.scores[key];
    if (h !== j)
      diffs.push({
        id: dimLabel(key, job.dims[key].plainName),
        text: "",
        human: String(h),
        judge: j === undefined ? "no score" : String(j),
      });
  }
  return { empty: false, unreadable: false, parsed, grade: g, diffs, compared };
}
