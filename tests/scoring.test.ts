import { describe, expect, it } from "vitest";
import { grade, type Marks } from "../src/shared/scoring";
import { newJob, newRow } from "../src/shared/model";
import type { Job, Line, Row } from "../src/shared/types";

const L = (id: string, text = id): Line => ({ id, text });

/**
 * Rubric used by most tests:
 *   accuracy 40 (hand), completeness 30 (fed by S), grounding 20 (fed by W), clarity 10 (hand)
 *   N -> auto-fail, U -> sets accuracy to 0, A -> auto-fail. Pass mark 85.
 */
function setup(): { job: Job; row: Row } {
  const job = newJob("Test");
  job.autoFails = [L("af1", "Leaks another household"), L("af2", "Sends without approval")];
  const use = (k: keyof Job["dims"], weight: number) => Object.assign(job.dims[k], { used: true, weight });
  use("accuracy", 40);
  use("completeness", 30);
  use("grounding", 20);
  use("clarity", 10);
  job.feeds = { say: "completeness", show: "grounding", not: "auto", unsure: "accuracy", allowed: "auto" };
  const row = newRow("GOLD-W1-001");
  row.mustSay = [L("s1"), L("s2")];
  row.mustShow = [L("w1")];
  row.mustNot = [L("n1"), L("n2")];
  row.ifUnsure = [L("u1")];
  row.allowed = [L("a1")];
  return { job, row };
}

function perfect(): Marks {
  return {
    auto: {},
    checks: { S: { s1: true, s2: true }, W: { w1: true }, N: { n1: false, n2: false }, U: { u1: true }, A: { a1: true } },
    scores: { accuracy: 5, clarity: 5 },
  };
}

describe("grade", () => {
  it("passes a perfect answer with 100 points", () => {
    const { job, row } = setup();
    const g = grade(job, row, perfect());
    expect(g.total).toBe(100);
    expect(g.verdict).toBe("pass");
    expect(g.missing).toEqual([]);
    expect(g.dims.map((d) => [d.key, d.source])).toEqual([
      ["accuracy", "hand"],
      ["grounding", "checks"],
      ["completeness", "checks"],
      ["clarity", "hand"],
    ]);
  });

  it("scores a check-fed dimension as 5 * met / total", () => {
    const { job, row } = setup();
    const m = perfect();
    m.checks.S = { s1: true, s2: false };
    const g = grade(job, row, m);
    const comp = g.dims.find((d) => d.key === "completeness")!;
    expect(comp.score).toBe(2.5);
    expect(comp.points).toBe(15);
    expect(g.total).toBe(85);
    expect(g.verdict).toBe("pass"); // exactly at pass mark
  });

  it("fails just under the pass mark", () => {
    const { job, row } = setup();
    const m = perfect();
    m.scores.clarity = 3; // 10 -> 6
    m.checks.S = { s1: true, s2: false }; // 30 -> 15
    const g = grade(job, row, m);
    expect(g.total).toBe(81);
    expect(g.verdict).toBe("fail");
    expect(g.autoFailures).toEqual([]);
  });

  it("auto-fails on a ticked automatic failure regardless of points", () => {
    const { job, row } = setup();
    const m = perfect();
    m.auto = { af2: true };
    const g = grade(job, row, m);
    expect(g.total).toBe(100);
    expect(g.verdict).toBe("fail");
    expect(g.autoFailures).toEqual(["Sends without approval"]);
  });

  it("auto-fails when a must-not rule is broken (N yes) and N is wired to auto", () => {
    const { job, row } = setup();
    const m = perfect();
    m.checks.N = { n1: false, n2: true };
    const g = grade(job, row, m);
    expect(g.verdict).toBe("fail");
    expect(g.autoFailures).toEqual(['Broke a "Must not do" rule']);
  });

  it("auto-fails when an allowed-ways rule is broken (A no)", () => {
    const { job, row } = setup();
    const m = perfect();
    m.checks.A = { a1: false };
    expect(grade(job, row, m).verdict).toBe("fail");
  });

  it("auto-fail wins even when other checks are unfinished", () => {
    const { job, row } = setup();
    const g = grade(job, row, { auto: { af1: true }, checks: { S: {}, W: {}, N: {}, U: {}, A: {} }, scores: {} });
    expect(g.verdict).toBe("fail");
    expect(g.complete).toBe(false);
  });

  it("zeroes the wired dimension when an if-unsure rule is broken (U no)", () => {
    const { job, row } = setup();
    const m = perfect();
    m.checks.U = { u1: false };
    const g = grade(job, row, m);
    const acc = g.dims.find((d) => d.key === "accuracy")!;
    expect(acc.score).toBe(0);
    expect(acc.source).toBe("zeroed");
    expect(g.total).toBe(60);
    expect(g.verdict).toBe("fail");
    expect(g.autoFailures).toEqual([]);
  });

  it("zeroes a check-fed dimension too, and a zeroed dim needs no hand score", () => {
    const { job, row } = setup();
    job.feeds.not = "completeness";
    const m = perfect();
    m.checks.N = { n1: true, n2: false };
    let g = grade(job, row, m);
    expect(g.dims.find((d) => d.key === "completeness")!.score).toBe(0);
    expect(g.total).toBe(70);

    job.feeds.unsure = "clarity";
    m.checks.U = { u1: false };
    delete m.scores.clarity;
    g = grade(job, row, m);
    expect(g.dims.find((d) => d.key === "clarity")!.score).toBe(0);
    expect(g.verdict).toBe("fail");
    expect(g.missing).toEqual([]);
  });

  it("is unfinished when a hand score is missing", () => {
    const { job, row } = setup();
    const m = perfect();
    delete m.scores.clarity;
    const g = grade(job, row, m);
    expect(g.verdict).toBe("unfinished");
    expect(g.missing).toEqual(["Score for Clarity"]);
    expect(g.total).toBe(90); // partial total still reported
  });

  it("is unfinished when a required check is unanswered", () => {
    const { job, row } = setup();
    const m = perfect();
    delete m.checks.S.s2;
    delete m.checks.N.n1;
    const g = grade(job, row, m);
    expect(g.verdict).toBe("unfinished");
    expect(g.missing).toEqual(["S2", "N1"]);
    expect(g.dims.find((d) => d.key === "completeness")!.score).toBeNull();
  });

  it("does not require checks in groups that are not wired", () => {
    const { job, row } = setup();
    job.feeds.allowed = "";
    const m = perfect();
    m.checks.A = {};
    expect(grade(job, row, m).verdict).toBe("pass");
    m.checks.A = { a1: false }; // broken but has no effect
    expect(grade(job, row, m).verdict).toBe("pass");
  });

  it("scores U in share mode as share followed and never zeroes", () => {
    const { job, row } = setup();
    job.feeds.unsure = "share:accuracy";
    row.ifUnsure = [L("u1"), L("u2")];
    const m = perfect();
    m.checks.U = { u1: true, u2: false };
    delete m.scores.accuracy; // not needed, accuracy is now check-fed
    const g = grade(job, row, m);
    const acc = g.dims.find((d) => d.key === "accuracy")!;
    expect(acc.source).toBe("checks");
    expect(acc.score).toBe(2.5);
    expect(g.total).toBe(80);
  });

  it("pools several groups that feed one dimension", () => {
    const { job, row } = setup();
    job.feeds.show = "completeness";
    job.dims.grounding.used = false;
    job.dims.completeness.weight = 50;
    const m = perfect();
    m.checks.S = { s1: true, s2: false };
    m.checks.W = { w1: true };
    const comp = grade(job, row, m).dims.find((d) => d.key === "completeness")!;
    expect(comp.score).toBeCloseTo((5 * 2) / 3);
    expect(comp.detail).toBe("2 of 3 checks met");
  });

  it("falls back to hand scoring when the row has no lines in the feeding group", () => {
    const { job, row } = setup();
    row.mustShow = [];
    const m = perfect();
    let g = grade(job, row, m);
    expect(g.dims.find((d) => d.key === "grounding")!.source).toBe("hand");
    expect(g.verdict).toBe("unfinished");
    m.scores.grounding = 5;
    g = grade(job, row, m);
    expect(g.verdict).toBe("pass");
  });

  it("ignores a feed that points at an unused dimension", () => {
    const { job, row } = setup();
    job.dims.grounding.used = false;
    job.dims.accuracy.weight = 60;
    const g = grade(job, row, perfect());
    expect(g.dims.map((d) => d.key)).not.toContain("grounding");
    expect(g.total).toBe(100);
  });

  it("never scores Speed and cost even if marked used", () => {
    const { job, row } = setup();
    job.dims.speed.used = true;
    job.dims.speed.weight = 10;
    const g = grade(job, row, perfect());
    expect(g.dims.map((d) => d.key)).not.toContain("speed");
    expect(g.weightTotal).toBe(100);
  });

  it("treats a hand score outside 0/3/5 as missing", () => {
    const { job, row } = setup();
    const m = perfect();
    (m.scores as Record<string, number>).clarity = 4;
    expect(grade(job, row, m).verdict).toBe("unfinished");
  });

  it("is unfinished with no dimensions in use", () => {
    const job = newJob("Empty");
    const row = newRow("GOLD-W1-001");
    const g = grade(job, row, { auto: {}, checks: { S: {}, W: {}, N: {}, U: {}, A: {} }, scores: {} });
    expect(g.verdict).toBe("unfinished");
    expect(g.missing).toEqual(["No dimensions in use"]);
  });

  it("keeps ticks attached to line ids when another line is edited or removed", () => {
    const { job, row } = setup();
    const m = perfect();
    m.checks.S = { s1: false, s2: true };
    row.mustSay = [L("s2", "edited text")]; // s1 removed, s2 rewritten
    const comp = grade(job, row, m).dims.find((d) => d.key === "completeness")!;
    expect(comp.score).toBe(5);
  });
});
