import { useState } from "react";
import { DIMS, DIM_BY_KEY } from "../../shared/dims";
import { uid } from "../../shared/ids";
import type { DimKey, Workstream } from "../../shared/types";
import { useCurrent, useJobUpdate, useStore } from "../store";
import { Card, ConfirmButton, TextField } from "../ui";

export function JobTab() {
  const { update, setUi } = useStore();
  const { ws, job } = useCurrent();
  const edit = useJobUpdate();
  const [msg, setMsg] = useState("");
  if (!ws || !job) return null;

  const editWs = (fn: (w: Workstream) => void) =>
    update((s) => {
      const w = s.workstreams.find((x) => x.id === ws.id);
      if (w) fn(w);
    });

  const mapped = [...new Set(job.failures.map((f) => f.dimKey).filter(Boolean))] as DimKey[];

  return (
    <>
      <Card>
        <h2>1. Name the job</h2>
        <p className="muted small">One job gets one rubric. A workstream groups related jobs.</p>
        <div className="grid2">
          <TextField label="Workstream name" value={ws.name} onChange={(v) => editWs((w) => void (w.name = v))} />
          <TextField label="Workstream code (used in row labels)" value={ws.code} onChange={(v) => editWs((w) => void (w.code = v.trim().toUpperCase()))} />
        </div>
        <div className="grid2">
          <TextField label="Job (use case)" value={job.name} placeholder="Draft a text reply" onChange={(v) => edit((j) => void (j.name = v))} />
          <TextField label="Who reads the answer" value={job.reader} placeholder="The advisor" onChange={(v) => edit((j) => void (j.reader = v))} />
        </div>
        <div className="row wrap">
          <ConfirmButton
            label="Delete this job"
            onConfirm={() => {
              update((s) => {
                const w = s.workstreams.find((x) => x.id === ws.id);
                if (w) w.jobs = w.jobs.filter((j) => j.id !== job.id);
              });
              setUi({ jobId: undefined, tab: 0 });
            }}
          />
          <ConfirmButton
            label="Delete this workstream"
            onConfirm={() => {
              update((s) => void (s.workstreams = s.workstreams.filter((w) => w.id !== ws.id)));
              setUi({ wsId: undefined, jobId: undefined, tab: 0 });
            }}
          />
        </div>
      </Card>

      <Card>
        <h2>2. List how an answer could fail</h2>
        <p className="muted small">Write each way this job can go wrong, then pick the classic dimension that would catch it.</p>
        {job.failures.length === 0 && <p className="muted">No failures listed yet.</p>}
        {job.failures.map((f, i) => (
          <div className="frow" key={f.id}>
            <input
              type="text"
              aria-label={`Failure ${i + 1}`}
              value={f.text}
              placeholder="Example: states a wrong date"
              onChange={(e) => edit((j) => void (j.failures[i].text = e.target.value))}
            />
            <select aria-label={`Dimension for failure ${i + 1}`} value={f.dimKey} onChange={(e) => edit((j) => void (j.failures[i].dimKey = e.target.value as DimKey | ""))}>
              <option value="">Pick a dimension</option>
              {DIMS.filter((d) => !d.neverScored).map((d) => (
                <option key={d.key} value={d.key}>
                  {d.name}
                </option>
              ))}
            </select>
            <button className="btn sm ghost" aria-label={`Remove failure ${i + 1}`} onClick={() => edit((j) => void j.failures.splice(i, 1))}>
              ✕
            </button>
          </div>
        ))}
        <div className="row wrap">
          <button className="btn" onClick={() => edit((j) => void j.failures.push({ id: uid(), text: "", dimKey: "" }))}>
            Add a failure
          </button>
          <button
            className="btn primary"
            disabled={!mapped.length}
            onClick={() => {
              const added = mapped.filter((k) => !job.dims[k].used);
              edit((j) => mapped.forEach((k) => void (j.dims[k].used = true)));
              setMsg(
                added.length
                  ? `Added ${added.map((k) => DIM_BY_KEY[k].name).join(", ")} to the rubric. Set their weights in Dimensions.`
                  : "All mapped dimensions are already in the rubric.",
              );
            }}
          >
            Add mapped dimensions to the rubric
          </button>
        </div>
        {msg && (
          <p className="note" role="status">
            {msg}
          </p>
        )}
      </Card>
    </>
  );
}
