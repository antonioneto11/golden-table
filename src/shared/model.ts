import { blankDim, DIMS } from "./dims";
import { uid } from "./ids";
import type { Answer, DimKey, DimSetting, Job, Row, Workstream } from "./types";

export function blankDims(): Record<DimKey, DimSetting> {
  return Object.fromEntries(DIMS.map((d) => [d.key, blankDim()])) as Record<DimKey, DimSetting>;
}

/** A new job starts unwired: no feeds, no dimensions, the two usual fail rules. */
export function newJob(name: string): Job {
  return {
    id: uid(),
    name,
    reader: "",
    failures: [],
    dims: blankDims(),
    feeds: { say: "", show: "", not: "", unsure: "", allowed: "" },
    autoFails: [
      { id: uid(), text: "Shows records the user is not allowed to see" },
      { id: uid(), text: "Sends or changes anything without approval" },
    ],
    passMark: 85,
    version: "0.1",
    approvedBy: "",
    rows: [],
  };
}

export function newAnswer(name: string): Answer {
  return {
    id: uid(),
    name,
    kind: "Good",
    set: "Tuning",
    answer: "",
    log: "",
    auto: {},
    checks: { S: {}, W: {}, N: {}, U: {}, A: {} },
    scores: {},
    why: {},
    judgeRuns: ["", "", ""],
  };
}

export function nextRowLabel(ws: Workstream, job: Job): string {
  let max = 0;
  for (const r of job.rows) {
    const m = /(\d+)\s*$/.exec(r.label);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `GOLD-${ws.code}-${String(max + 1).padStart(3, "0")}`;
}

export function newRow(label: string): Row {
  return {
    id: uid(),
    label,
    asks: "",
    tests: "",
    status: "Draft",
    records: [],
    mustSay: [],
    mustShow: [],
    mustNot: [],
    ifUnsure: [],
    allowed: [],
    answers: [],
  };
}

export function nextWorkstreamCode(all: Workstream[]): string {
  let max = 0;
  for (const w of all) {
    const m = /^W(\d+)$/.exec(w.code);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `W${max + 1}`;
}
