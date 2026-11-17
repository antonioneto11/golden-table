export const DIM_KEYS = [
  "accuracy",
  "grounding",
  "completeness",
  "relevance",
  "sources",
  "privacy",
  "actions",
  "gaps",
  "clarity",
  "usefulness",
  "consistency",
  "robustness",
  "ranking",
  "speed",
] as const;
export type DimKey = (typeof DIM_KEYS)[number];

/** S must say, W must show, N must not do, U if unsure, A allowed ways. */
export const GROUPS = ["S", "W", "N", "U", "A"] as const;
export type Group = (typeof GROUPS)[number];

export type Score = 0 | 3 | 5;
export const SCALE: readonly Score[] = [0, 3, 5];

/** A single editable line with a stable id, so ticks survive edits to other lines. */
export interface Line {
  id: string;
  text: string;
}

export interface DimSetting {
  used: boolean;
  plainName: string;
  weight: number;
  whyNotUsed: string;
  s0: string;
  s3: string;
  s5: string;
}

/**
 * How check groups drive scores, set per job.
 * say/show: a dimKey scored by share met, or "" for no effect.
 * not/allowed: "" no effect | "auto" auto-fail | dimKey set to 0 when broken.
 * unsure: as above, plus "share:<dimKey>" to score that dim by share followed.
 */
export interface Feeds {
  say: DimKey | "";
  show: DimKey | "";
  not: "" | "auto" | DimKey;
  unsure: "" | "auto" | DimKey | `share:${DimKey}`;
  allowed: "" | "auto" | DimKey;
}

export interface Failure {
  id: string;
  text: string;
  dimKey: DimKey | "";
}

export interface RecordItem {
  id: string; // "R1"
  label: string;
  text: string;
}

export type RowStatus = "Draft" | "In review" | "Approved";

export interface Row {
  id: string;
  label: string; // "GOLD-W1-001"
  asks: string;
  tests: string;
  status: RowStatus;
  records: RecordItem[];
  mustSay: Line[];
  mustShow: Line[];
  mustNot: Line[];
  ifUnsure: Line[];
  allowed: Line[];
  answers: Answer[];
}

export type Ticks = Record<string, boolean>; // line id -> yes/no

export interface Answer {
  id: string;
  name: string;
  kind: "Good" | "Borderline" | "Bad";
  set: "Tuning" | "Holdout";
  answer: string;
  log: string;
  /** auto-fail line id -> hit */
  auto: Ticks;
  checks: Record<Group, Ticks>;
  scores: Partial<Record<DimKey, Score>>;
  why: Partial<Record<DimKey, string>>;
  judgeRuns: [string, string, string];
}

export interface Job {
  id: string;
  name: string;
  reader: string;
  example?: boolean;
  failures: Failure[];
  dims: Record<DimKey, DimSetting>;
  feeds: Feeds;
  autoFails: Line[];
  passMark: number;
  version: string;
  approvedBy: string;
  rows: Row[];
}

export interface Workstream {
  id: string;
  code: string; // "W1"
  name: string;
  jobs: Job[];
}

export interface AppState {
  version: 1;
  workstreams: Workstream[];
}

/** Which row field holds each check group. */
export const GROUP_FIELD = {
  S: "mustSay",
  W: "mustShow",
  N: "mustNot",
  U: "ifUnsure",
  A: "allowed",
} as const satisfies Record<Group, keyof Row>;

/** Which feed setting governs each check group. */
export const GROUP_FEED = {
  S: "say",
  W: "show",
  N: "not",
  U: "unsure",
  A: "allowed",
} as const satisfies Record<Group, keyof Feeds>;
