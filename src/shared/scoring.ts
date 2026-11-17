import { DIM_BY_KEY, DIMS, GROUP_INFO } from "./dims";
import {
  GROUP_FEED,
  GROUP_FIELD,
  GROUPS,
  SCALE,
  type Answer,
  type DimKey,
  type Group,
  type Job,
  type Line,
  type Row,
} from "./types";

/** The grades being scored: a person's ticks, or a judge run merged with the person's code checks. */
export type Marks = Pick<Answer, "auto" | "checks" | "scores">;

export type Verdict = "pass" | "fail" | "unfinished";

export interface DimResult {
  key: DimKey;
  weight: number;
  /** 0..5, or null when not yet decidable. */
  score: number | null;
  points: number | null;
  source: "checks" | "hand" | "zeroed";
  detail: string;
}

export interface GradeResult {
  dims: DimResult[];
  weightTotal: number;
  total: number;
  /** Human-readable reasons for automatic failure. */
  autoFailures: string[];
  /** Rule groups (N, U, A) with at least one broken line. */
  broken: Group[];
  /** Check ids ("S2") and scores still needed for a verdict. */
  missing: string[];
  complete: boolean;
  verdict: Verdict;
}

export function groupLines(row: Row, g: Group): Line[] {
  return row[GROUP_FIELD[g]];
}

export function usedDimKeys(job: Job): DimKey[] {
  return DIMS.filter((d) => !d.neverScored && job.dims[d.key]?.used).map((d) => d.key);
}

export function weightTotal(job: Job): number {
  return usedDimKeys(job).reduce((s, k) => s + (Number(job.dims[k].weight) || 0), 0);
}

/** Groups that score `dim` by share met (S/W pointed at it, or U in share mode). */
export function shareGroupsFor(job: Job, dim: DimKey): Group[] {
  const f = job.feeds;
  const out: Group[] = [];
  if (f.say === dim) out.push("S");
  if (f.show === dim) out.push("W");
  if (f.unsure === `share:${dim}`) out.push("U");
  return out;
}

/** Share groups for `dim` that actually have lines on this row. */
export function feedingGroups(job: Job, row: Row, dim: DimKey): Group[] {
  return shareGroupsFor(job, dim).filter((g) => groupLines(row, g).length > 0);
}

/** Used dimensions this row needs a hand score for (0/3/5). */
export function handDims(job: Job, row: Row): DimKey[] {
  return usedDimKeys(job).filter((k) => feedingGroups(job, row, k).length === 0);
}

/**
 * What a group's lines do on this job. "share" and "dim" effects are only live
 * if they point at a used dimension; otherwise the group has no effect.
 */
export function groupEffect(
  job: Job,
  g: Group,
): { kind: "none" } | { kind: "auto" } | { kind: "zero"; dim: DimKey } | { kind: "share"; dim: DimKey } {
  const used = new Set(usedDimKeys(job));
  const v = job.feeds[GROUP_FEED[g]] as string;
  if (!v) return { kind: "none" };
  if (v === "auto") return GROUP_INFO[g].rule ? { kind: "auto" } : { kind: "none" };
  const isShare = !GROUP_INFO[g].rule || v.startsWith("share:");
  const dim = (v.startsWith("share:") ? v.slice(6) : v) as DimKey;
  if (!used.has(dim)) return { kind: "none" };
  return isShare ? { kind: "share", dim } : { kind: "zero", dim };
}

export function isBroken(g: Group, value: boolean | undefined): boolean {
  const info = GROUP_INFO[g];
  return info.rule && value !== undefined && value === info.brokenWhen;
}

/**
 * The one scoring function, used for both human and judge grades.
 * - S/W (and U in share mode) score their dimension as 5 * met / total.
 * - Other used dimensions are scored by hand on 0, 3 or 5.
 * - A broken rule group (N yes, U/A no) auto-fails or zeroes its wired dimension.
 * - Points = score / 5 * weight; total = sum over used dimensions.
 * - Verdict: fail on any automatic failure; unfinished if anything required is
 *   missing; otherwise pass when total >= pass mark.
 */
export function grade(job: Job, row: Row, marks: Marks): GradeResult {
  const tick = (g: Group, id: string): boolean | undefined => {
    const v = marks.checks?.[g]?.[id];
    return typeof v === "boolean" ? v : undefined;
  };

  const autoFailures = job.autoFails.filter((l) => marks.auto?.[l.id] === true).map((l) => l.text || "(unnamed rule)");
  const missing: string[] = [];
  const broken: Group[] = [];
  const zeroedBy: Partial<Record<DimKey, string>> = {};
  const effects = Object.fromEntries(GROUPS.map((g) => [g, groupEffect(job, g)])) as Record<
    Group,
    ReturnType<typeof groupEffect>
  >;

  // Which groups must be fully answered: any group whose lines affect the result.
  for (const g of GROUPS) {
    const lines = groupLines(row, g);
    const eff = effects[g];
    if (eff.kind === "none") continue;
    lines.forEach((l, i) => {
      if (tick(g, l.id) === undefined) missing.push(`${g}${i + 1}`);
    });
  }

  // Rule groups: broken lines auto-fail or zero a dimension.
  for (const g of GROUPS) {
    if (!GROUP_INFO[g].rule) continue;
    const isAnyBroken = groupLines(row, g).some((l) => isBroken(g, tick(g, l.id)));
    if (!isAnyBroken) continue;
    broken.push(g);
    const eff = effects[g];
    if (eff.kind === "auto") autoFailures.push(`Broke a "${GROUP_INFO[g].title}" rule`);
    else if (eff.kind === "zero") zeroedBy[eff.dim] ??= GROUP_INFO[g].title;
  }

  const dims: DimResult[] = [];
  let total = 0;
  for (const key of usedDimKeys(job)) {
    const weight = Number(job.dims[key].weight) || 0;
    const feeds = feedingGroups(job, row, key);
    let score: number | null = null;
    let source: DimResult["source"] = "hand";
    let detail = "By hand";

    if (feeds.length) {
      source = "checks";
      let met = 0;
      let n = 0;
      let answered = true;
      for (const g of feeds) {
        for (const l of groupLines(row, g)) {
          const v = tick(g, l.id);
          n++;
          if (v === undefined) answered = false;
          else if (v) met++;
        }
      }
      if (answered) {
        score = (5 * met) / n;
        detail = `${met} of ${n} checks met`;
      } else {
        detail = "Checks not finished";
      }
    } else {
      const s = marks.scores?.[key];
      if (s !== undefined && (SCALE as readonly number[]).includes(s)) score = s;
    }

    if (zeroedBy[key]) {
      score = 0;
      source = "zeroed";
      detail = `"${zeroedBy[key]}" broken`;
    } else if (source === "hand" && score === null) {
      missing.push(`Score for ${DIM_BY_KEY[key].name}`);
    }

    const points = score === null ? null : (score / 5) * weight;
    if (points !== null) total += points;
    dims.push({ key, weight, score, points, source, detail });
  }

  if (dims.length === 0) missing.push("No dimensions in use");

  total = Math.round(total * 1000) / 1000;
  const complete = missing.length === 0;
  const verdict: Verdict = autoFailures.length
    ? "fail"
    : !complete
      ? "unfinished"
      : total >= (Number(job.passMark) || 0)
        ? "pass"
        : "fail";

  return { dims, weightTotal: weightTotal(job), total, autoFailures, broken, missing, complete, verdict };
}
