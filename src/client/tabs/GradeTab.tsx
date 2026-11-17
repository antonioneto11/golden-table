import { useState } from "react";
import { answerAgreement } from "../../shared/agreement";
import { dimLabel, GROUP_INFO } from "../../shared/dims";
import { buildJudgeCalls } from "../../shared/judge";
import { newAnswer } from "../../shared/model";
import { grade, groupEffect, groupLines, handDims, weightTotal, type GradeResult } from "../../shared/scoring";
import { GROUPS, SCALE, type Answer, type Group, type Job, type Row, type Score } from "../../shared/types";
import { useCurrent, useJobUpdate, useStore } from "../store";
import { Card, ConfirmButton, fmt, Seg, SelectField, TextField, VerdictPill } from "../ui";

function effectNote(job: Job, g: Group): string {
  const e = groupEffect(job, g);
  const info = GROUP_INFO[g];
  const word = info.brokenWhen ? "A yes" : "A no";
  if (e.kind === "none") return "Not wired to the score. Set it in Score guide.";
  if (e.kind === "share") return `Scores ${dimLabel(e.dim, job.dims[e.dim].plainName)} by share met.`;
  if (e.kind === "auto") return `${word} fails the answer.`;
  return `${word} sets ${dimLabel(e.dim, job.dims[e.dim].plainName)} to 0.`;
}

export function PointsTable({ job, g }: { job: Job; g: GradeResult }) {
  return (
    <>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Dimension</th>
              <th className="num">Weight</th>
              <th className="num">Score</th>
              <th className="num">Points</th>
              <th>From</th>
            </tr>
          </thead>
          <tbody>
            {g.dims.map((d) => (
              <tr key={d.key}>
                <td>{dimLabel(d.key, job.dims[d.key].plainName)}</td>
                <td className="num">{fmt(d.weight)}</td>
                <td className="num">{d.score === null ? "–" : `${fmt(d.score)} of 5`}</td>
                <td className="num">{d.points === null ? "–" : fmt(d.points)}</td>
                <td className="muted">{d.detail}</td>
              </tr>
            ))}
            <tr className="tot">
              <td>Total</td>
              <td className="num">{fmt(g.weightTotal)}</td>
              <td />
              <td className="num">{fmt(g.total)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="verdict">
        <VerdictPill g={g} />
        {g.autoFailures.length > 0 ? (
          <span>Automatic failure: {g.autoFailures.join("; ")}. Points do not count.</span>
        ) : g.verdict === "unfinished" ? (
          <span>Still needed: {g.missing.join(", ")}</span>
        ) : (
          <span>Pass mark is {job.passMark}.</span>
        )}
      </div>
      {g.weightTotal !== 100 && <p className="note err">Weights add up to {fmt(g.weightTotal)}, not 100. Fix them in Dimensions.</p>}
    </>
  );
}

function JudgeRuns({ job, row, a, editAnswer }: { job: Job; row: Row; a: Answer; editAnswer: (fn: (x: Answer) => void) => void }) {
  const { config, judging, judgeMessage, runJudge } = useStore();
  const ag = answerAgreement(job, row, a);
  const calls = buildJudgeCalls(job, row, a);
  const busy = Boolean(judging);
  const mine = judging && judging.targets[judging.index]?.answerId === a.id;
  const full = a.judgeRuns.every((t) => t.trim());
  return (
    <Card>
      <h2>9. Run the judge on this answer</h2>
      <p className="muted small">
        {calls.length} call{calls.length === 1 ? "" : "s"}: one for the yes/no checks (not “Allowed ways”), one per hand-scored dimension. The same scoring function turns the
        judge's answers into points. Up to three runs show whether the judge repeats itself.
      </p>
      <div className="row wrap">
        <button
          className="btn primary"
          disabled={busy || full || !config?.judgeReady || !calls.length}
          onClick={() => void runJudge([{ jobId: job.id, rowId: row.id, answerId: a.id }])}
        >
          {mine ? `Running call ${judging!.call + 1} of ${judging!.calls}…` : "Run judge"}
        </button>
        {!config?.judgeReady && <span className="muted small">Set ANTHROPIC_API_KEY and JUDGE_MODEL in .env to run it here. </span>}
        {full && <span className="muted small">All three runs are filled. Remove one to run again.</span>}
      </div>
      {judgeMessage && <p className={`note ${judgeMessage.error ? "err" : ""}`}>{judgeMessage.text}</p>}
      <details>
        <summary>Show the exact prompts</summary>
        {calls.map((c, i) => (
          <div key={i} className="sub" style={{ marginTop: 8 }}>
            <span className="flabel">
              Call {i + 1}: {c.title}
            </span>
            <pre className="prompt">{c.prompt}</pre>
          </div>
        ))}
      </details>
      {ag.runs.every((r) => r.empty) && <p className="muted small">No judge runs yet for this answer.</p>}
      {[0, 1, 2].map((k) => {
        const r = ag.runs[k];
        if (r.empty) return null;
        return (
          <div key={k} className="sub">
            <div className="row wrap">
              <span className="flabel">Run {k + 1}</span>
              {r.unreadable ? <span className="pill warn">Couldn't read this result</span> : <VerdictPill g={r.grade} />}
              {r.grade && ag.human.verdict !== "unfinished" && r.grade.verdict !== "unfinished" && (
                <span className={`pill ${r.grade.verdict === ag.human.verdict ? "ok" : "bad"}`}>
                  {r.grade.verdict === ag.human.verdict ? "Same verdict as you" : r.grade.verdict === "pass" ? "False pass" : "False fail"}
                </span>
              )}
              {r.parsed?.warnings.map((w) => (
                <span key={w} className="pill warn">
                  {w}
                </span>
              ))}
              <ConfirmButton label="Remove run" onConfirm={() => editAnswer((x) => void (x.judgeRuns[k] = ""))} />
            </div>
            {r.diffs.length > 0 && (
              <ul className="diff small">
                {r.diffs.map((d) => (
                  <li key={d.id}>
                    <strong>{d.id}</strong>
                    {d.text && ` ${d.text}`}: you {d.human}, judge {d.judge}
                  </li>
                ))}
              </ul>
            )}
            {r.grade && r.diffs.length === 0 && <span className="muted small">No differences from your grades.</span>}
            <details>
              <summary>Show the judge's raw reply</summary>
              <pre className="prompt">{a.judgeRuns[k]}</pre>
            </details>
          </div>
        );
      })}
      <PasteRun full={full} onAdd={(text) => editAnswer((x) => {
        const slot = x.judgeRuns.findIndex((t) => !t.trim());
        if (slot >= 0) x.judgeRuns[slot] = text;
      })} />
    </Card>
  );
}

/** Advanced: add a judge result produced outside the app (e.g. by another model). */
function PasteRun({ full, onAdd }: { full: boolean; onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <details>
      <summary>Advanced: add a judge result by hand</summary>
      <div className="sub" style={{ marginTop: 8 }}>
        <p className="muted small">
          Only needed if you ran the judge prompts in another tool. Paste the judge's reply exactly as it came back; it must contain the JSON format shown in the
          prompts.
        </p>
        <TextField area rows={4} label="Judge result to add" value={text} onChange={setText} />
        <div className="row wrap">
          <button
            className="btn"
            disabled={full || !text.trim()}
            onClick={() => {
              onAdd(text);
              setText("");
            }}
          >
            Add this result
          </button>
          {full && <span className="muted small">All three runs are filled. Remove one first.</span>}
        </div>
      </div>
    </details>
  );
}

export function GradeTab() {
  const { ui, setUi } = useStore();
  const { job } = useCurrent();
  const edit = useJobUpdate();
  if (!job) return null;
  if (!job.rows.length)
    return (
      <Card>
        <h2>Grade answers</h2>
        <p>Add a golden row first.</p>
        <div>
          <button className="btn" onClick={() => setUi({ tab: 4 })}>
            Go to Golden rows
          </button>
        </div>
      </Card>
    );

  const row = job.rows.find((r) => r.id === ui.gradeRowId) ?? job.rows[0];
  const a = row.answers.find((x) => x.id === ui.answerId) ?? row.answers[0];
  const editAnswer = (fn: (x: Answer) => void) =>
    edit((j) => {
      const x = j.rows.find((r) => r.id === row.id)?.answers.find((y) => y.id === a?.id);
      if (x) fn(x);
    });
  const addAnswer = () => {
    const n = newAnswer(`Answer ${row.answers.length + 1}`);
    edit((j) => void j.rows.find((r) => r.id === row.id)?.answers.push(n));
    setUi({ gradeRowId: row.id, answerId: n.id });
  };

  const header = (
    <Card>
      <h2>8. Grade several answers per row by hand</h2>
      <p className="muted small">Give each row a good, a borderline and a bad answer. These grades are what the judge is tested against.</p>
      <SelectField
        label="Golden row"
        value={row.id}
        options={job.rows.map((r) => ({ value: r.id, label: `${r.label}  ${r.asks}` }))}
        onChange={(v) => setUi({ gradeRowId: v, answerId: job.rows.find((r) => r.id === v)?.answers[0]?.id })}
      />
      <div className="bar" aria-label="Answers">
        {row.answers.map((x) => (
          <button key={x.id} className={`chip ${x.id === a?.id ? "on" : ""}`} onClick={() => setUi({ gradeRowId: row.id, answerId: x.id })}>
            {x.name || "Answer"}
          </button>
        ))}
        <button className="chip add" onClick={addAnswer}>
          + Answer
        </button>
      </div>
    </Card>
  );
  if (!a)
    return (
      <>
        {header}
        <Card>
          <p>No answers for this row yet. Add one to grade it.</p>
        </Card>
      </>
    );

  const g = grade(job, row, a);
  const hand = handDims(job, row);
  const autoHit = job.autoFails.some((l) => a.auto[l.id]);

  return (
    <>
      {header}
      <Card>
        <div className="grid2">
          <TextField label="Answer name" value={a.name} onChange={(v) => editAnswer((x) => void (x.name = v))} />
          <SelectField<Answer["kind"]>
            label="What it is meant to be"
            value={a.kind}
            options={(["Good", "Borderline", "Bad"] as const).map((v) => ({ value: v, label: v }))}
            onChange={(v) => editAnswer((x) => void (x.kind = v))}
          />
        </div>
        <SelectField<Answer["set"]>
          label="Used for"
          value={a.set}
          options={[
            { value: "Tuning", label: "Tuning: may appear as a worked example in judge prompts for other rows" },
            { value: "Holdout", label: "Holdout: never shown to the judge" },
          ]}
          onChange={(v) => editAnswer((x) => void (x.set = v))}
        />
        <TextField area rows={5} label="Answer from the assistant" placeholder="Paste or write the answer to grade" value={a.answer} onChange={(v) => editAnswer((x) => void (x.answer = v))} />
        <TextField area rows={2} label="Action log (tool trace)" placeholder="Read only this household's records. Sent nothing." value={a.log} onChange={(v) => editAnswer((x) => void (x.log = v))} />
      </Card>

      <Card className={autoHit ? "hit" : ""}>
        <h3>Automatic failures (code checks from the action log)</h3>
        <p className="muted small">Tick any rule the action log shows was broken.</p>
        {job.autoFails.length === 0 && <p className="muted">No fail rules set.</p>}
        {job.autoFails.map((l) => (
          <label key={l.id} className="row">
            <input type="checkbox" checked={!!a.auto[l.id]} onChange={(e) => editAnswer((x) => void (x.auto[l.id] = e.target.checked))} />
            <span>{l.text || "(empty rule)"}</span>
          </label>
        ))}
      </Card>

      {GROUPS.map((grp) => {
        const lines = groupLines(row, grp);
        if (!lines.length) return null;
        const info = GROUP_INFO[grp];
        const eff = groupEffect(job, grp);
        const hit = g.broken.includes(grp) && (eff.kind === "auto" || eff.kind === "zero");
        return (
          <Card key={grp} className={hit ? "hit" : ""}>
            <h3>
              {info.title}
              {info.code ? " (code check)" : ""}
            </h3>
            <p className="muted small">
              {info.question} {effectNote(job, grp)}
            </p>
            {lines.map((l, i) => (
              <div className="chk" key={l.id}>
                <span className="txt">
                  <span className="tag">
                    {grp}
                    {i + 1}
                  </span>{" "}
                  {l.text || <em className="muted">(empty line)</em>}
                </span>
                <Seg<"yes" | "no">
                  label={`${grp}${i + 1}`}
                  value={a.checks[grp][l.id] === true ? "yes" : a.checks[grp][l.id] === false ? "no" : undefined}
                  options={[
                    { value: "yes", label: "Yes" },
                    { value: "no", label: "No" },
                  ]}
                  onChange={(v) =>
                    editAnswer((x) => {
                      if (v === undefined) delete x.checks[grp][l.id];
                      else x.checks[grp][l.id] = v === "yes";
                    })
                  }
                />
              </div>
            ))}
          </Card>
        );
      })}

      {hand.map((k) => {
        const d = job.dims[k];
        const sc = a.scores[k];
        return (
          <Card key={k}>
            <div className="row wrap">
              <h3 className="grow">{dimLabel(k, d.plainName)}</h3>
              <span className="pill plain">Weight {d.weight}</span>
            </div>
            <p className="muted small">
              0: {d.s0 || "not described"}
              <br />
              3: {d.s3 || "not described"}
              <br />
              5: {d.s5 || "not described"}
            </p>
            <Seg<Score>
              label={`Score for ${dimLabel(k, d.plainName)}`}
              value={sc}
              options={SCALE.map((v) => ({ value: v, label: String(v) }))}
              onChange={(v) =>
                editAnswer((x) => {
                  if (v === undefined) delete x.scores[k];
                  else x.scores[k] = v;
                })
              }
            />
            <TextField label="Why (one line, quoting the answer)" value={a.why[k] ?? ""} onChange={(v) => editAnswer((x) => void (x.why[k] = v))} />
          </Card>
        );
      })}

      <Card>
        <h2>Your result</h2>
        <PointsTable job={job} g={g} />
        {weightTotal(job) === 0 && <p className="note">No dimensions in use yet. Pick them in Dimensions.</p>}
      </Card>

      <JudgeRuns job={job} row={row} a={a} editAnswer={editAnswer} />

      <div className="row wrap">
        <ConfirmButton
          label="Delete this answer"
          onConfirm={() => {
            edit((j) => {
              const r = j.rows.find((x) => x.id === row.id);
              if (r) r.answers = r.answers.filter((x) => x.id !== a.id);
            });
            setUi({ answerId: undefined });
          }}
        />
      </div>
    </>
  );
}
