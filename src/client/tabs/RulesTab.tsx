import { useCurrent, useJobUpdate } from "../store";
import { Card, LineEditor, NumberField, TextField } from "../ui";

export function RulesTab() {
  const { job } = useCurrent();
  const edit = useJobUpdate();
  if (!job) return null;
  return (
    <>
      <Card>
        <h2>5. Set automatic failures</h2>
        <p className="muted small">
          Yes/no rules outside the score. One hit fails the answer whatever the points. These are code checks, decided from the action log, and are never sent to the
          judge.
        </p>
        <LineEditor label="Automatic failures" prefix="F" lines={job.autoFails} placeholder="Example: sends anything without approval" onChange={(ls) => edit((j) => void (j.autoFails = ls))} />
      </Card>
      <Card>
        <h2>6. Pass mark, version and approval</h2>
        <div className="grid2">
          <NumberField label="Pass mark out of 100" value={job.passMark} onChange={(v) => edit((j) => void (j.passMark = v))} />
          <TextField label="Rubric version" value={job.version} onChange={(v) => edit((j) => void (j.version = v))} />
        </div>
        <TextField label="Approved by" value={job.approvedBy} placeholder="Nobody yet" onChange={(v) => edit((j) => void (j.approvedBy = v))} />
      </Card>
    </>
  );
}
