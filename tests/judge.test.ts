import { describe, expect, it } from "vitest";
import { agreement } from "../src/shared/agreement";
import { buildJudgeCalls, evaluateRun, JUDGE_GROUPS, parseJudgeOutput } from "../src/shared/judge";
import { newAnswer } from "../src/shared/model";
import { grade, groupLines, handDims } from "../src/shared/scoring";
import { seedState } from "../src/shared/seed";
import type { Answer, Job, Row } from "../src/shared/types";

function seedJobs() {
  const [catchUp, reply] = seedState().workstreams[0].jobs;
  return { catchUp, reply };
}

/** Judge output that copies the person's grades exactly. */
function mirror(job: Job, row: Row, a: Answer, flip?: string): string {
  const checks: Record<string, { why: string; yes: boolean }> = {};
  for (const g of JUDGE_GROUPS)
    groupLines(row, g).forEach((l, i) => {
      const id = `${g}${i + 1}`;
      const v = a.checks[g][l.id] === true;
      checks[id] = { why: "quoted", yes: id === flip ? !v : v };
    });
  const scores = Object.fromEntries(handDims(job, row).map((k) => [k, { why: "r", score: a.scores[k] }]));
  return `${JSON.stringify({ checks })}\n${JSON.stringify({ scores })}`;
}

describe("seed data", () => {
  it("ships two example jobs; every seeded answer has a final human verdict", () => {
    const { catchUp, reply } = seedJobs();
    expect(catchUp.example && reply.example).toBe(true);
    expect(catchUp.rows).toHaveLength(2);
    expect(reply.rows).toHaveLength(1);
    expect(reply.rows[0].answers).toHaveLength(10);
    const verdicts = Object.fromEntries(reply.rows[0].answers.map((a) => [a.name, grade(reply, reply.rows[0], a).verdict]));
    expect(verdicts).toEqual({
      "1 Ideal": "pass",
      "2 Invented fact": "fail",
      "3 Half an answer": "fail",
      "4 Right but cold": "pass",
      "5 Warm but vague": "fail",
      "6 Overclaims": "fail",
      "7 Leaks another household": "fail",
      "8 Sent without approval": "fail",
      "9 Wrong source": "fail",
      "10 Too long": "pass",
    });
  });
});

describe("buildJudgeCalls", () => {
  it("makes one checks call plus one per hand-scored dimension", () => {
    const { reply } = seedJobs();
    const row = reply.rows[0];
    const calls = buildJudgeCalls(reply, row, row.answers[0]);
    expect(calls.map((c) => [c.kind, c.dim])).toEqual([
      ["checks", undefined],
      ["score", "accuracy"],
      ["score", "clarity"],
    ]);
  });

  it("includes question, full records, checks, answer and log; excludes A, auto-fails, weights and pass mark", () => {
    const { reply } = seedJobs();
    const row = reply.rows[0];
    const a = row.answers[6];
    for (const c of buildJudgeCalls(reply, row, a)) {
      expect(c.prompt).toContain(row.asks);
      for (const r of row.records) expect(c.prompt).toContain(r.text);
      expect(c.prompt).toContain(a.log);
      expect(c.prompt).toContain("Okafor");
      expect(c.prompt).not.toContain(row.allowed[0].text);
      for (const af of reply.autoFails) expect(c.prompt).not.toContain(af.text);
      expect(c.prompt.toLowerCase()).not.toMatch(/weight|pass mark|\b85\b|\b35\b/);
      expect(c.prompt.indexOf("reason")).toBeGreaterThan(-1);
    }
    const checks = buildJudgeCalls(reply, row, a)[0].prompt;
    expect(checks).toContain("S3. The transfer timing is not confirmed yet");
    expect(checks).toContain("N3. Rely on the superseded 20 Oct note (R4)");
    expect(checks).not.toMatch(/\bA1\b/);
    const clarity = buildJudgeCalls(reply, row, a)[2].prompt;
    expect(clarity).toContain(reply.dims.clarity.s3);
    expect(clarity).toContain('"why"');
  });

  it("uses worked examples only from Tuning answers on other rows, never Holdout", () => {
    const { catchUp } = seedJobs();
    const [rivera, patel] = catchUp.rows;
    const good = rivera.answers.find((a) => a.set === "Tuning")!;
    const bad = rivera.answers.find((a) => a.set === "Holdout")!;
    const a = newAnswer("probe");
    a.answer = "Probe answer for the Patel row.";
    const calls = buildJudgeCalls(catchUp, patel, a);
    const all = calls.map((c) => c.prompt).join("\n");
    expect(all).toContain(good.answer);
    expect(all).not.toContain(bad.answer);

    // Make every answer Holdout: no examples at all.
    good.set = "Holdout";
    const none = buildJudgeCalls(catchUp, patel, a).map((c) => c.prompt).join("\n");
    expect(none).not.toContain(good.answer);
    expect(none).not.toContain("WORKED EXAMPLE");
  });

  it("never uses other answers on the same row as examples", () => {
    const { reply } = seedJobs();
    const row = reply.rows[0];
    const all = buildJudgeCalls(reply, row, row.answers[0]).map((c) => c.prompt).join("\n");
    expect(all).not.toContain("funds will move by Friday");
  });
});

describe("parseJudgeOutput", () => {
  it("reads fenced JSON surrounded by prose and several objects", () => {
    const text =
      'Here you go:\n```json\n{"checks":{"S1":{"why":"says \\"received\\" {sic}","yes":true},"s2":{"why":"","yes":"no"},"N 1":{"yes":"Yes"}}}\n```\nand\n{"scores":{"Clarity":{"why":"ok","score":"3"}}}';
    const p = parseJudgeOutput(text);
    expect(p.ok).toBe(true);
    expect(p.checks.S).toEqual({ 0: true, 1: false });
    expect(p.checks.N).toEqual({ 0: true });
    expect(p.scores).toEqual({ clarity: 3 });
  });

  it("accepts bare booleans and numbers, ignores A and unknown keys, warns on bad scores", () => {
    const p = parseJudgeOutput('{"checks":{"S1":true,"A1":false,"X9":true,"U1":"maybe"},"scores":{"accuracy":4,"speed":5,"nonsense":3}}');
    expect(p.checks.S).toEqual({ 0: true });
    expect(p.checks.A).toEqual({});
    expect(p.scores).toEqual({ speed: 5 });
    expect(p.warnings).toEqual(["U1: no yes/no", "accuracy: score 4 is not 0, 3 or 5"]);
  });

  it("reports unreadable output", () => {
    expect(parseJudgeOutput("I cannot help with that.").ok).toBe(false);
    expect(parseJudgeOutput('{"checks": {"S1": ').ok).toBe(false);
  });
});

describe("evaluateRun and agreement", () => {
  it("a judge that mirrors the person has no differences and the same verdict", () => {
    const { reply } = seedJobs();
    const row = reply.rows[0];
    for (const a of row.answers) {
      const r = evaluateRun(reply, row, a, mirror(reply, row, a));
      expect(r.diffs).toEqual([]);
      expect(r.grade!.verdict).toBe(grade(reply, row, a).verdict);
    }
  });

  it("uses the person's A ticks and auto-fails for judge runs", () => {
    const { reply } = seedJobs();
    const row = reply.rows[0];
    const leak = row.answers.find((a) => a.name.startsWith("7"))!;
    const r = evaluateRun(reply, row, leak, mirror(reply, row, leak));
    expect(r.grade!.verdict).toBe("fail");
    expect(r.grade!.autoFailures.length).toBeGreaterThan(0);
  });

  it("lists the exact checks and scores that differ", () => {
    const { reply } = seedJobs();
    const row = reply.rows[0];
    const a = row.answers[1]; // invented fact: N1 yes
    const text = mirror(reply, row, a, "N1").replace('"clarity":{"why":"r","score":5}', '"clarity":{"why":"r","score":3}');
    const r = evaluateRun(reply, row, a, text);
    expect(r.diffs).toEqual([
      { id: "N1", text: "Give or promise a transfer date", human: "Yes", judge: "No" },
      { id: "Clarity: Tone and clarity", text: "", human: "5", judge: "3" },
    ]);
  });

  it("computes verdict agreement, splits, false passes/fails, gap, single checks and repeat stability", () => {
    const { reply } = seedJobs();
    const row = reply.rows[0];
    const [ideal, invented, half] = row.answers;
    ideal.judgeRuns = [mirror(reply, row, ideal), mirror(reply, row, ideal), ""];
    // Judge misses the invented fact -> accuracy not zeroed -> false pass.
    invented.judgeRuns = [mirror(reply, row, invented, "N1").replace('"U1":{"why":"quoted","yes":false}', '"U1":{"why":"quoted","yes":true}').replace('"accuracy":{"why":"r","score":0}', '"accuracy":{"why":"r","score":5}'), "", ""];
    half.judgeRuns = ["not json", "", ""];
    const ag = agreement(reply);
    expect(ag.graded).toBe(10);
    expect(ag.compared).toBe(2);
    expect(ag.all).toEqual({ n: 2, agree: 1 });
    expect(ag.tuning).toEqual({ n: 2, agree: 1 });
    expect(ag.holdout).toEqual({ n: 0, agree: 0 });
    expect(ag.falsePasses).toBe(1);
    expect(ag.falseFails).toBe(0);
    const inventedRow = ag.answers.find((x) => x.answer === invented)!;
    expect(inventedRow.judge!.grade!.verdict).toBe("pass");
    expect(ag.avgPointGap).toBeCloseTo(Math.abs(inventedRow.judge!.grade!.total - inventedRow.human.total) / 2);
    // 9 checks + 2 scores per answer; N1, U1 and accuracy differ on the invented answer
    expect(ag.checks).toEqual({ n: 22, agree: 19 });
    expect(ag.repeat).toEqual({ answers: 1, stable: 1 });
    expect(ag.answers.find((x) => x.answer === half)!.runs[0].unreadable).toBe(true);
  });
});
