import { DIMS } from "../../shared/dims";
import { usedDimKeys, weightTotal } from "../../shared/scoring";
import { useCurrent, useJobUpdate } from "../store";
import { Card, fmt, NumberField, TextField } from "../ui";

export function DimsTab() {
  const { job } = useCurrent();
  const edit = useJobUpdate();
  if (!job) return null;
  const mapped: Record<string, string[]> = {};
  for (const f of job.failures) if (f.dimKey) (mapped[f.dimKey] ??= []).push(f.text || "(unnamed failure)");
  const w = weightTotal(job);
  const n = usedDimKeys(job).length;

  return (
    <>
      <Card className="off">
        <h2>3. Choose 3 to 5 dimensions and weight them to 100</h2>
        <p className="muted small">Give the costliest mistake the biggest weight. For every dimension you leave out, write why.</p>
      </Card>
      {DIMS.map((d) => {
        const x = job.dims[d.key];
        const on = x.used && !d.neverScored;
        const id = `use-${d.key}`;
        return (
          <Card key={d.key} className={on ? "" : "off"}>
            <div className="dimhead">
              {!d.neverScored && (
                <input id={id} type="checkbox" checked={x.used} onChange={(e) => edit((j) => void (j.dims[d.key].used = e.target.checked))} />
              )}
              <div className="grow">
                <h3>
                  <label htmlFor={id}>{d.name}</label>
                </h3>
                <p className="muted small">{d.question}</p>
                {mapped[d.key] && <p className="small">Catches: {mapped[d.key].join("; ")}</p>}
              </div>
              <div className="tags" aria-label="Usually checked by">
                {d.checkedBy.map((b) => (
                  <span key={b} className="tag">
                    {b}
                  </span>
                ))}
              </div>
            </div>
            {d.neverScored ? (
              <p className="note">Never scored. Report speed and cost next to quality, not inside the score.</p>
            ) : on ? (
              <div className="dimedit">
                <TextField label="Plain name on the rubric" value={x.plainName} placeholder={d.name} onChange={(v) => edit((j) => void (j.dims[d.key].plainName = v))} />
                <NumberField label="Weight" value={x.weight} onChange={(v) => edit((j) => void (j.dims[d.key].weight = v))} />
              </div>
            ) : (
              <TextField
                label="Why it is not used"
                value={x.whyNotUsed}
                placeholder="Example: the reader is the advisor"
                onChange={(v) => edit((j) => void (j.dims[d.key].whyNotUsed = v))}
              />
            )}
          </Card>
        );
      })}
      <div className="sticky" aria-live="polite">
        <strong>Weights total {fmt(w)} of 100</strong>
        <span className={`pill ${w === 100 ? "ok" : "bad"}`}>{w === 100 ? "Adds up" : w < 100 ? `${fmt(100 - w)} left to give` : `${fmt(w - 100)} too many`}</span>
        <span className={`pill ${n >= 3 && n <= 5 ? "ok" : "warn"}`}>
          {n} dimension{n === 1 ? "" : "s"}
          {n < 3 ? ", pick at least 3" : n > 5 ? ", keep it to 5" : ""}
        </span>
      </div>
    </>
  );
}
