import { agreement, type Split } from "../../shared/agreement";
import { useCurrent, useStore } from "../store";
import { Card, fmt, plural, VerdictPill } from "../ui";

const pct = (s: Split) => (s.n ? `${s.agree} of ${s.n} (${Math.round((100 * s.agree) / s.n)}%)` : "none yet");

export function JudgeTab() {
  const { config, judging, judgeMessage, runJudge, setUi } = useStore();
  const { job } = useCurrent();
  if (!job) return null;
  const ag = agreement(job);
  const decisive = ag.answers.filter((x) => x.human.verdict !== "unfinished");
  const noRun = decisive.filter((x) => x.runs.every((r) => r.empty));
  const hasSlot = decisive.filter((x) => x.answer.judgeRuns.some((t) => !t.trim()));
  const target = (list: typeof decisive) => list.map((x) => ({ jobId: job.id, rowId: x.row.id, answerId: x.answer.id }));
  const status = (answerId: string): string | null => {
    if (!judging) return null;
    const i = judging.targets.findIndex((t) => t.answerId === answerId);
    if (i < 0) return null;
    if (i < judging.index) return "Done";
    if (i === judging.index) return `Running call ${judging.call + 1} of ${judging.calls}…`;
    return "Queued";
  };

  return (
    <>
      <Card>
        <h2>10. Check the judge against your grades</h2>
        <p className="muted small">
          A judge is ready when it agrees with you on answers it was not tuned on and never passes an answer you failed. Suggested bar: 20+ graded answers, zero false
          passes, 9 in 10 agreement on Holdout.
        </p>
        <div className="summary">
          <span className={`pill ${ag.graded >= 20 ? "ok" : "warn"}`}>{ag.graded} graded by you</span>
          <span className="pill plain">{ag.compared} also judged</span>
          <span className={`pill ${!ag.compared ? "plain" : ag.all.agree === ag.all.n ? "ok" : "warn"}`}>Verdicts agree: {pct(ag.all)}</span>
          <span className="pill plain">Tuning: {pct(ag.tuning)}</span>
          <span className={`pill ${!ag.holdout.n ? "warn" : ag.holdout.agree / ag.holdout.n >= 0.9 ? "ok" : "bad"}`}>Holdout: {pct(ag.holdout)}</span>
          <span className={`pill ${ag.falsePasses ? "bad" : ag.compared ? "ok" : "plain"}`}>{plural(ag.falsePasses, "false pass", "es")}</span>
          <span className={`pill ${ag.falseFails ? "warn" : ag.compared ? "ok" : "plain"}`}>{plural(ag.falseFails, "false fail")}</span>
          <span className="pill plain">Average point gap {ag.avgPointGap === null ? "–" : fmt(ag.avgPointGap)}</span>
          <span className={`pill ${!ag.checks.n ? "plain" : ag.checks.agree === ag.checks.n ? "ok" : "warn"}`}>Single checks and scores agree: {pct(ag.checks)}</span>
          <span className={`pill ${!ag.repeat.answers ? "plain" : ag.repeat.stable === ag.repeat.answers ? "ok" : "bad"}`}>
            Same verdict on repeat runs: {ag.repeat.answers ? `${ag.repeat.stable} of ${ag.repeat.answers}` : "no repeat runs yet"}
          </span>
        </div>
        <div className="row wrap">
          <button className="btn primary" disabled={!!judging || !noRun.length || !config?.judgeReady} onClick={() => void runJudge(target(noRun))}>
            Run all: {plural(noRun.length, "answer")} with no run
          </button>
          <button className="btn" disabled={!!judging || !hasSlot.length || !config?.judgeReady} onClick={() => void runJudge(target(hasSlot))}>
            Add a repeat run to {plural(hasSlot.length, "answer")}
          </button>
        </div>
        {!config?.judgeReady && <p className="note">Set ANTHROPIC_API_KEY and JUDGE_MODEL in .env and restart to run the judge. Pasted runs still count.</p>}
        {judging && (
          <p className="note" role="status">
            Judging answer {judging.index + 1} of {judging.targets.length}, call {judging.call + 1} of {judging.calls}…
          </p>
        )}
        {judgeMessage && !judging && (
          <p className={`note ${judgeMessage.error ? "err" : ""}`} role={judgeMessage.error ? "alert" : "status"}>
            {judgeMessage.text}
          </p>
        )}
        {ag.totalAnswers > ag.graded && (
          <p className="muted small">{plural(ag.totalAnswers - ag.graded, "answer")} not counted because your grading is unfinished.</p>
        )}
      </Card>

      {!ag.answers.length ? (
        <Card>
          <p>No answers yet. Add and grade some in Grade answers.</p>
        </Card>
      ) : (
        <Card>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Answer</th>
                  <th>You</th>
                  <th>Judge</th>
                </tr>
              </thead>
              <tbody>
                {ag.answers.map((x) => {
                  const st = status(x.answer.id);
                  const j = x.judge;
                  const firstRun = x.runs.find((r) => !r.empty);
                  const match =
                    j && x.human.verdict !== "unfinished"
                      ? j.grade!.verdict === x.human.verdict
                        ? { cls: "ok", text: "Agrees" }
                        : { cls: "bad", text: j.grade!.verdict === "pass" ? "False pass" : "False fail" }
                      : null;
                  const rep = x.decisive.length > 1 ? (x.decisive.every((r) => r.grade!.verdict === x.decisive[0].grade!.verdict) ? `Same verdict in ${x.decisive.length} runs` : "Verdict changed between runs") : "";
                  const diffs = (j ?? firstRun)?.diffs ?? [];
                  return [
                    <tr key={x.answer.id}>
                      <td>
                        <button className="btn sm" onClick={() => setUi({ tab: 5, gradeRowId: x.row.id, answerId: x.answer.id })}>
                          {x.answer.name || "Answer"}
                        </button>
                        <div className="muted small">
                          {x.row.label} · {x.answer.kind} · {x.answer.set}
                        </div>
                      </td>
                      <td>
                        <VerdictPill g={x.human} />
                      </td>
                      <td>
                        {st ? (
                          <span className="pill plain">{st}</span>
                        ) : firstRun?.unreadable && !j ? (
                          <span className="pill warn">Unreadable output</span>
                        ) : (
                          <VerdictPill g={j?.grade ?? firstRun?.grade} none={x.human.verdict === "unfinished" ? "Grade it first" : "No run yet"} />
                        )}
                        {match && (
                          <div>
                            <span className={`pill ${match.cls}`}>{match.text}</span>
                          </div>
                        )}
                        {rep && <div className="muted small">{rep}</div>}
                      </td>
                    </tr>,
                    diffs.length > 0 && (
                      <tr key={x.answer.id + "-d"}>
                        <td colSpan={3} className="small">
                          <span className="flabel">Judge differs on</span>
                          <ul className="diff">
                            {diffs.map((d) => (
                              <li key={d.id}>
                                <strong>{d.id}</strong>
                                {d.text && ` ${d.text}`}: you {d.human}, judge {d.judge}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
