import { useRef } from "react";
import { agreement } from "../shared/agreement";
import { newJob, nextWorkstreamCode } from "../shared/model";
import { exportJob, formatZodError, importJob } from "../shared/schema";
import { usedDimKeys, weightTotal } from "../shared/scoring";
import { uid } from "../shared/ids";
import type { Job } from "../shared/types";
import { useCurrent, useStore, type Theme } from "./store";
import { download, fmt, plural } from "./ui";
import { JobTab } from "./tabs/JobTab";
import { DimsTab } from "./tabs/DimsTab";
import { GuideTab } from "./tabs/GuideTab";
import { RulesTab } from "./tabs/RulesTab";
import { RowsTab } from "./tabs/RowsTab";
import { GradeTab } from "./tabs/GradeTab";
import { JudgeTab } from "./tabs/JudgeTab";

export const TABS = ["Job and failures", "Dimensions", "Score guide", "Fail rules", "Golden rows", "Grade answers", "Judge check"];

function SummaryStrip({ job }: { job: Job }) {
  const n = usedDimKeys(job).length;
  const w = weightTotal(job);
  const rules = job.autoFails.filter((l) => l.text.trim()).length;
  const ag = agreement(job);
  return (
    <div className="summary" aria-label="Summary">
      <span className={`pill ${n >= 3 && n <= 5 ? "ok" : "warn"}`}>{plural(n, "dimension")} (3 to 5)</span>
      <span className={`pill ${w === 100 ? "ok" : "bad"}`}>Weights {fmt(w)} of 100</span>
      <span className={`pill ${rules ? "ok" : "warn"}`}>{plural(rules, "fail rule")}</span>
      <span className={`pill ${job.rows.length >= 10 ? "ok" : "warn"}`}>{job.rows.length} of 10 rows</span>
      <span className={`pill ${ag.graded >= 20 ? "ok" : "warn"}`}>{ag.graded} of 20 graded answers</span>
      <span className="pill plain">Pass mark {job.passMark}</span>
      {ag.compared ? (
        <span className={`pill ${ag.falsePasses ? "bad" : ag.all.agree === ag.all.n ? "ok" : "warn"}`}>
          Judge agrees {ag.all.agree} of {ag.all.n}
        </span>
      ) : (
        <span className="pill plain">No judge runs yet</span>
      )}
    </div>
  );
}

function SaveIndicator() {
  const { save } = useStore();
  const text =
    save.kind === "saving" ? "Saving…" : save.kind === "saved" ? "Saved" : save.kind === "error" ? "Not saved, retrying" : save.kind === "conflict" ? "Not saved" : "";
  return (
    <span className="status" role="status" aria-live="polite">
      {text}
    </span>
  );
}

export function App() {
  const { state, update, ui, setUi, save, flash, judgeMessage } = useStore();
  const { ws, job } = useCurrent();
  const fileRef = useRef<HTMLInputElement>(null);
  const tab = Math.min(Math.max(ui.tab, 0), TABS.length - 1);

  const addWorkstream = () => {
    const id = uid();
    update((s) => {
      s.workstreams.push({ id, code: nextWorkstreamCode(s.workstreams), name: "New workstream", jobs: [] });
    });
    setUi({ wsId: id, jobId: undefined, tab: 0 });
  };
  const addJob = () => {
    if (!ws) return;
    const j = newJob("New job");
    update((s) => {
      s.workstreams.find((w) => w.id === ws.id)?.jobs.push(j);
    });
    setUi({ jobId: j.id, tab: 0 });
  };

  const onImport = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      let wsId = ws?.id;
      const j = importJob(data, ws?.jobs.map((x) => x.name) ?? []);
      update((s) => {
        let target = s.workstreams.find((w) => w.id === wsId);
        if (!target) {
          target = { id: uid(), code: nextWorkstreamCode(s.workstreams), name: "Imported", jobs: [] };
          s.workstreams.push(target);
          wsId = target.id;
        }
        target.jobs.push(j);
      });
      setUi({ wsId, jobId: j.id, tab: 0 });
      flash(`Imported "${j.name}" as a new job.`);
    } catch (e) {
      flash(`Could not import that file: ${e instanceof SyntaxError ? "it is not valid JSON" : formatZodError(e)}`, true);
    }
  };

  const onExport = () => {
    if (!job) return;
    const slug = job.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "job";
    download(`${slug}.json`, JSON.stringify(exportJob(job), null, 2));
  };

  return (
    <>
      <header className="top">
        <div>
          <h1>Golden Table Simulator</h1>
          <p className="muted small">Build a rubric and golden rows, grade answers by hand, then test an LLM judge against your grades.</p>
        </div>
        <div className="acts">
          <SaveIndicator />
          <label className="visually-hidden" htmlFor="theme">
            Theme
          </label>
          <select id="theme" value={ui.theme} onChange={(e) => setUi({ theme: e.target.value as Theme })} style={{ width: "auto" }}>
            <option value="system">System theme</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Import job
          </button>
          <button className="btn" onClick={onExport} disabled={!job}>
            Export job
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onImport(f);
            }}
          />
        </div>
      </header>

      {save.kind === "conflict" && (
        <div className="banner" role="alert">
          <span className="grow">{save.message} Your last edits in this tab were not saved.</span>
          <button className="btn sm" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      )}
      {save.kind === "error" && <p className="note err">Saving failed: {save.message}</p>}
      {judgeMessage && tab < 5 && <p className={`note ${judgeMessage.error ? "err" : ""}`}>{judgeMessage.text}</p>}

      <nav className="bar" aria-label="Workstreams">
        <span className="lbl">Workstream</span>
        {state.workstreams.map((w) => (
          <button key={w.id} className={`chip ${ws?.id === w.id ? "on" : ""}`} onClick={() => setUi({ wsId: w.id, jobId: w.jobs[0]?.id })}>
            {w.code} {w.name}
          </button>
        ))}
        <button className="chip add" onClick={addWorkstream}>
          + Workstream
        </button>
      </nav>
      {ws && (
        <nav className="bar" aria-label="Jobs">
          <span className="lbl">Job</span>
          {ws.jobs.map((j) => (
            <button key={j.id} className={`chip ${job?.id === j.id ? "on" : ""}`} onClick={() => setUi({ jobId: j.id })}>
              {j.name || "Untitled job"}
            </button>
          ))}
          <button className="chip add" onClick={addJob}>
            + Job
          </button>
        </nav>
      )}

      {!ws && (
        <div className="card">
          <p>Add a workstream to start.</p>
        </div>
      )}
      {ws && !job && (
        <div className="card">
          <p>This workstream has no jobs yet. Add one to start.</p>
          <div>
            <button className="btn primary" onClick={addJob}>
              Add a job
            </button>
          </div>
        </div>
      )}
      {ws && job && (
        <>
          <SummaryStrip job={job} />
          {job.example && <p className="note">This is an example job with invented households and records. Edit it freely or add your own job.</p>}
          <nav className="tabs" aria-label="Steps" role="tablist">
            {TABS.map((t, i) => (
              <button key={t} role="tab" aria-selected={i === tab} className={`tab ${i === tab ? "on" : ""}`} onClick={() => setUi({ tab: i })}>
                <span className="n">{i + 1}</span>
                {t}
              </button>
            ))}
          </nav>
          <main className="panel" key={job.id}>
            {tab === 0 && <JobTab />}
            {tab === 1 && <DimsTab />}
            {tab === 2 && <GuideTab />}
            {tab === 3 && <RulesTab />}
            {tab === 4 && <RowsTab />}
            {tab === 5 && <GradeTab />}
            {tab === 6 && <JudgeTab />}
            <div className="foot">
              {tab > 0 ? (
                <button className="btn" onClick={() => setUi({ tab: tab - 1 })}>
                  ← {TABS[tab - 1]}
                </button>
              ) : (
                <span />
              )}
              {tab < TABS.length - 1 && (
                <button className="btn primary" onClick={() => setUi({ tab: tab + 1 })}>
                  {TABS[tab + 1]} →
                </button>
              )}
            </div>
          </main>
        </>
      )}
    </>
  );
}
