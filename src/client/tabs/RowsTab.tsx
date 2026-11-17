import { useState } from "react";
import { GROUP_INFO } from "../../shared/dims";
import { uid } from "../../shared/ids";
import { newRow, nextRowLabel } from "../../shared/model";
import { grade } from "../../shared/scoring";
import { SUGGEST_FIELDS, suggestRequestFor, type SuggestedChecks } from "../../shared/suggest";
import { GROUP_FIELD, GROUPS, type Job, type Row, type RowStatus } from "../../shared/types";
import { api } from "../api";
import { useCurrent, useJobUpdate, useStore } from "../store";
import { Card, ConfirmButton, LineEditor, SelectField, TextField } from "../ui";

const ROW_KINDS = [
  "one open item",
  "several open items",
  "open mixed with finished",
  "nothing open",
  "conflicting records",
  "a household the user cannot see",
  "the same question reworded",
];

const FIELD_HINT: Record<string, string> = {
  S: "One checkable fact per line.",
  W: "One record or proof per line.",
  N: "One tempting mistake per line. Yes = rule broken.",
  U: "One rule per line, with the safe phrasing. No = rule broken.",
  A: "One rule per line. A code check from the action log, never sent to the judge.",
};

type SuggestState = { rowId: string; busy: boolean; error?: string; draft?: SuggestedChecks };

function RowSummary({ job, row }: { job: Job; row: Row }) {
  if (!row.answers.length) return <span className="pill plain">No answers</span>;
  let p = 0;
  let f = 0;
  for (const a of row.answers) {
    const v = grade(job, row, a).verdict;
    if (v === "pass") p++;
    else if (v === "fail") f++;
  }
  return (
    <span className="pill plain">
      {row.answers.length} answers: {p} pass, {f} fail
    </span>
  );
}

export function RowsTab() {
  const { ui, setUi } = useStore();
  const { ws, job } = useCurrent();
  const edit = useJobUpdate();
  const [suggest, setSuggest] = useState<SuggestState | null>(null);
  if (!ws || !job) return null;

  const editRow = (rowId: string, fn: (r: Row) => void) =>
    edit((j) => {
      const r = j.rows.find((x) => x.id === rowId);
      if (r) fn(r);
    });

  const addRow = () => {
    const r = newRow(nextRowLabel(ws));
    edit((j) => void j.rows.push(r));
    setUi({ openRowId: r.id });
  };

  const askSuggest = async (row: Row) => {
    if (!row.asks.trim() || !row.records.some((r) => (r.text || r.label).trim())) {
      setSuggest({ rowId: row.id, busy: false, error: "Add the question and at least one record first." });
      return;
    }
    setSuggest({ rowId: row.id, busy: true });
    try {
      const { draft } = await api.suggest(suggestRequestFor(job, row));
      setSuggest({ rowId: row.id, busy: false, draft });
    } catch (e) {
      setSuggest({ rowId: row.id, busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const applySuggest = (row: Row, mode: "replace" | "append") => {
    const d = suggest?.draft;
    if (!d) return;
    editRow(row.id, (r) => {
      for (const f of SUGGEST_FIELDS) {
        if (!d[f].length) continue;
        const add = d[f].map((text) => ({ id: uid(), text }));
        r[f] = mode === "replace" ? add : [...r[f], ...add];
      }
    });
    setSuggest(null);
  };

  return (
    <>
      <Card className="off">
        <h2>7. Write the golden rows</h2>
        <p className="muted small">Each row tests one thing. Try to cover: {ROW_KINDS.join(", ")}.</p>
        <div>
          <button className="btn primary" onClick={addRow}>
            Add a row
          </button>
        </div>
      </Card>
      {!job.rows.length && (
        <Card>
          <p>No rows yet.</p>
        </Card>
      )}
      {job.rows.map((r) => {
        const open = ui.openRowId === r.id;
        const graded = r.answers.length > 0;
        const s = suggest?.rowId === r.id ? suggest : null;
        return (
          <Card key={r.id}>
            <button className="rowhead" aria-expanded={open} onClick={() => setUi({ openRowId: open ? undefined : r.id })}>
              <span className="grow">
                <span className="id">{r.label}</span> <span className="muted">{r.asks || "No question yet"}</span>
              </span>
              <span className="row wrap">
                <span className="pill plain">{r.status}</span>
                <RowSummary job={job} row={r} />
              </span>
            </button>
            {open && (
              <>
                <div className="grid2">
                  <TextField label="Case ID" value={r.label} onChange={(v) => editRow(r.id, (x) => void (x.label = v))} />
                  <SelectField<RowStatus>
                    label="Status"
                    value={r.status}
                    options={(["Draft", "In review", "Approved"] as const).map((v) => ({ value: v, label: v }))}
                    onChange={(v) => editRow(r.id, (x) => void (x.status = v))}
                  />
                </div>
                <TextField label="The user asks" value={r.asks} placeholder="What is still open for the Rivera household?" onChange={(v) => editRow(r.id, (x) => void (x.asks = v))} />
                <TextField label="What this row tests (one thing)" value={r.tests} onChange={(v) => editRow(r.id, (x) => void (x.tests = v))} />

                <div className="sub">
                  <span className="flabel">Records: frozen copies with dates. Paste the real text, not a summary, so the judge can check against it.</span>
                  {r.records.map((rec, k) => (
                    <div className="rec" key={rec.id + k}>
                      <div className="row">
                        <span className="tag">{rec.id}</span>
                        <input
                          className="grow"
                          type="text"
                          aria-label={`Record ${rec.id} source and date`}
                          placeholder="Source and date, e.g. Client text, 5 Oct"
                          value={rec.label}
                          onChange={(e) => editRow(r.id, (x) => void (x.records[k].label = e.target.value))}
                        />
                        <ConfirmButton label="Remove" onConfirm={() => editRow(r.id, (x) => void x.records.splice(k, 1))} />
                      </div>
                      <textarea
                        rows={3}
                        aria-label={`Record ${rec.id} text`}
                        placeholder="The record's full text"
                        value={rec.text}
                        onChange={(e) => editRow(r.id, (x) => void (x.records[k].text = e.target.value))}
                      />
                    </div>
                  ))}
                  <div>
                    <button
                      className="btn sm"
                      onClick={() =>
                        editRow(r.id, (x) => {
                          const max = x.records.reduce((m, rec) => Math.max(m, Number(/^R(\d+)$/.exec(rec.id)?.[1] ?? 0)), 0);
                          x.records.push({ id: `R${max + 1}`, label: "", text: "" });
                        })
                      }
                    >
                      Add a record
                    </button>
                  </div>
                </div>

                <div className="sub">
                  <div className="row wrap">
                    <button className="btn" disabled={s?.busy} onClick={() => void askSuggest(r)}>
                      {s?.busy ? "Asking the model…" : "Suggest checks from records"}
                    </button>
                  </div>
                  <p className="muted small">The model drafts the five check fields from the question and records. Nothing changes until you apply it.</p>
                  {s?.error && <p className="note err">{s.error}</p>}
                  {s?.draft && (
                    <Card className="off">
                      <h3>Suggested checks (draft)</h3>
                      {GROUPS.map((g) => {
                        const items = s.draft![GROUP_FIELD[g]];
                        return (
                          <div key={g}>
                            <span className="flabel">{GROUP_INFO[g].title}</span>
                            {items.length ? (
                              <ul className="diff">
                                {items.map((t, i) => (
                                  <li key={i}>{t}</li>
                                ))}
                              </ul>
                            ) : (
                              <p className="muted small">No suggestion</p>
                            )}
                          </div>
                        );
                      })}
                      <p className="muted small">
                        Check each line against the records before applying.
                        {graded && " This row already has graded answers: replaced lines are new checks, so those answers will need ticking again."}
                      </p>
                      <div className="row wrap">
                        <button className="btn primary" onClick={() => applySuggest(r, "replace")}>
                          Replace fields with these
                        </button>
                        <button className="btn" onClick={() => applySuggest(r, "append")}>
                          Add below existing lines
                        </button>
                        <button className="btn ghost" onClick={() => setSuggest(null)}>
                          Discard
                        </button>
                      </div>
                    </Card>
                  )}
                </div>

                <div className="grid2">
                  {(["S", "W"] as const).map((g) => (
                    <LineEditor key={g} label={GROUP_INFO[g].title} hint={FIELD_HINT[g]} prefix={g} lines={r[GROUP_FIELD[g]]} onChange={(ls) => editRow(r.id, (x) => void (x[GROUP_FIELD[g]] = ls))} />
                  ))}
                </div>
                <div className="grid2">
                  {(["N", "U"] as const).map((g) => (
                    <LineEditor key={g} label={GROUP_INFO[g].title} hint={FIELD_HINT[g]} prefix={g} lines={r[GROUP_FIELD[g]]} onChange={(ls) => editRow(r.id, (x) => void (x[GROUP_FIELD[g]] = ls))} />
                  ))}
                </div>
                <LineEditor label={GROUP_INFO.A.title} hint={FIELD_HINT.A} prefix="A" lines={r.allowed} onChange={(ls) => editRow(r.id, (x) => void (x.allowed = ls))} />

                <div className="row wrap">
                  <button className="btn primary" onClick={() => setUi({ tab: 5, gradeRowId: r.id, answerId: r.answers[0]?.id })}>
                    Grade answers for this row
                  </button>
                  <ConfirmButton
                    label="Delete row"
                    onConfirm={() => {
                      edit((j) => void (j.rows = j.rows.filter((x) => x.id !== r.id)));
                      setUi({ openRowId: undefined });
                    }}
                  />
                </div>
              </>
            )}
          </Card>
        );
      })}
    </>
  );
}
