import { evaluateRun, type JudgeRunResult } from "./judge";
import { grade, type GradeResult } from "./scoring";
import type { Answer, Job, Row } from "./types";

export interface AnswerAgreement {
  row: Row;
  answer: Answer;
  human: GradeResult;
  runs: JudgeRunResult[];
  /** First run with a pass/fail verdict: the one compared with the person. */
  judge: JudgeRunResult | null;
  /** Runs with a pass/fail verdict. */
  decisive: JudgeRunResult[];
}

export interface Split {
  n: number;
  agree: number;
}

export interface Agreement {
  answers: AnswerAgreement[];
  totalAnswers: number;
  /** Answers with a human pass/fail verdict. */
  graded: number;
  /** Graded answers with at least one decisive judge run. */
  compared: number;
  all: Split;
  tuning: Split;
  holdout: Split;
  falsePasses: number;
  falseFails: number;
  avgPointGap: number | null;
  checks: Split;
  repeat: { answers: number; stable: number };
}

const decisive = (g?: GradeResult) => g?.verdict === "pass" || g?.verdict === "fail";

export function answerAgreement(job: Job, row: Row, answer: Answer): AnswerAgreement {
  const human = grade(job, row, answer);
  const runs = answer.judgeRuns.map((t) => evaluateRun(job, row, answer, t ?? ""));
  const dec = runs.filter((r) => decisive(r.grade));
  return { row, answer, human, runs, judge: dec[0] ?? null, decisive: dec };
}

export function agreement(job: Job): Agreement {
  const answers = job.rows.flatMap((row) => row.answers.map((a) => answerAgreement(job, row, a)));
  const graded = answers.filter((x) => decisive(x.human));
  const both = graded.filter((x) => x.judge);
  const split = (set?: Answer["set"]): Split => {
    const b = both.filter((x) => !set || x.answer.set === set);
    return { n: b.length, agree: b.filter((x) => x.judge!.grade!.verdict === x.human.verdict).length };
  };
  let cn = 0;
  let cd = 0;
  for (const x of both) {
    cn += x.judge!.compared;
    cd += x.judge!.diffs.length;
  }
  const multi = both.filter((x) => x.decisive.length > 1);
  return {
    answers,
    totalAnswers: answers.length,
    graded: graded.length,
    compared: both.length,
    all: split(),
    tuning: split("Tuning"),
    holdout: split("Holdout"),
    falsePasses: both.filter((x) => x.judge!.grade!.verdict === "pass" && x.human.verdict === "fail").length,
    falseFails: both.filter((x) => x.judge!.grade!.verdict === "fail" && x.human.verdict === "pass").length,
    avgPointGap: both.length
      ? both.reduce((s, x) => s + Math.abs(x.judge!.grade!.total - x.human.total), 0) / both.length
      : null,
    checks: { n: cn, agree: cn - cd },
    repeat: {
      answers: multi.length,
      stable: multi.filter((x) => x.decisive.every((r) => r.grade!.verdict === x.decisive[0].grade!.verdict)).length,
    },
  };
}
