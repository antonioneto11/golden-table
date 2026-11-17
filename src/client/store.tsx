import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildJudgeCalls } from "../shared/judge";
import type { Answer, AppState, Job, Row, Workstream } from "../shared/types";
import { api, ApiError, type Config } from "./api";

export type Theme = "system" | "light" | "dark";

export interface Ui {
  wsId?: string;
  jobId?: string;
  tab: number;
  openRowId?: string;
  gradeRowId?: string;
  answerId?: string;
  theme: Theme;
}

export type SaveStatus = { kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string } | { kind: "conflict"; message: string };

export interface JudgeTarget {
  jobId: string;
  rowId: string;
  answerId: string;
}

export interface JudgeProgress {
  targets: JudgeTarget[];
  index: number;
  call: number;
  calls: number;
}

interface Store {
  state: AppState;
  update: (fn: (draft: AppState) => void) => void;
  ui: Ui;
  setUi: (patch: Partial<Ui>) => void;
  save: SaveStatus;
  config: Config | null;
  judging: JudgeProgress | null;
  judgeMessage: { text: string; error: boolean } | null;
  runJudge: (targets: JudgeTarget[]) => Promise<void>;
  flash: (text: string, error?: boolean) => void;
}

const Ctx = createContext<Store | null>(null);
const UI_KEY = "golden-table-ui";

function loadUi(): Ui {
  try {
    const raw = localStorage.getItem(UI_KEY);
    if (raw) return { tab: 0, theme: "system", ...(JSON.parse(raw) as Partial<Ui>) };
  } catch {
    /* storage unavailable */
  }
  return { tab: 0, theme: "system" };
}

export function findJob(s: AppState, jobId?: string): { ws: Workstream; job: Job } | null {
  for (const ws of s.workstreams) for (const job of ws.jobs) if (job.id === jobId) return { ws, job };
  return null;
}

export function findAnswer(s: AppState, t: JudgeTarget): { job: Job; row: Row; answer: Answer } | null {
  const j = findJob(s, t.jobId);
  const row = j?.job.rows.find((r) => r.id === t.rowId);
  const answer = row?.answers.find((a) => a.id === t.answerId);
  return j && row && answer ? { job: j.job, row, answer } : null;
}

export function StoreProvider({ initial, rev, children }: { initial: AppState; rev: number; children: ReactNode }) {
  const [state, setState] = useState(initial);
  const [ui, setUiState] = useState<Ui>(loadUi);
  const [save, setSave] = useState<SaveStatus>({ kind: "idle" });
  const [config, setConfig] = useState<Config | null>(null);
  const [judging, setJudging] = useState<JudgeProgress | null>(null);
  const [judgeMessage, setJudgeMessage] = useState<Store["judgeMessage"]>(null);

  const stateRef = useRef(initial);
  const revRef = useRef(rev);
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conflict = useRef(false);

  useEffect(() => {
    api.config().then(setConfig, () => setConfig({ judgeReady: false, hasKey: false, model: "" }));
  }, []);

  const persist = useCallback(async () => {
    if (inFlight.current || !dirty.current || conflict.current) return;
    inFlight.current = true;
    dirty.current = false;
    setSave({ kind: "saving" });
    try {
      const r = await api.save(stateRef.current, revRef.current);
      revRef.current = r.rev;
      setSave(dirty.current ? { kind: "saving" } : { kind: "saved" });
    } catch (e) {
      dirty.current = true;
      if (e instanceof ApiError && e.status === 409) {
        conflict.current = true;
        setSave({ kind: "conflict", message: e.message });
      } else {
        setSave({ kind: "error", message: e instanceof Error ? e.message : String(e) });
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void persist(), 4000);
      }
    } finally {
      inFlight.current = false;
      if (dirty.current && !conflict.current) {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void persist(), 400);
      }
    }
  }, []);

  const update = useCallback(
    (fn: (draft: AppState) => void) => {
      const next = structuredClone(stateRef.current);
      fn(next);
      stateRef.current = next;
      setState(next);
      dirty.current = true;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void persist(), 400);
    },
    [persist],
  );

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current || inFlight.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const setUi = useCallback((patch: Partial<Ui>) => {
    setUiState((u) => {
      const next = { ...u, ...patch };
      try {
        localStorage.setItem(UI_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (ui.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", ui.theme);
  }, [ui.theme]);

  const flash = useCallback((text: string, error = false) => setJudgeMessage({ text, error }), []);

  /** Run the judge on each target in turn, filling its next empty run slot. Stops at the first error. */
  const runJudge = useCallback(
    async (targets: JudgeTarget[]) => {
      if (!targets.length) return;
      setJudgeMessage(null);
      let added = 0;
      let full = 0;
      try {
        for (let i = 0; i < targets.length; i++) {
          const found = findAnswer(stateRef.current, targets[i]);
          if (!found) continue;
          const slot = found.answer.judgeRuns.findIndex((t) => !t.trim());
          if (slot < 0) {
            full++;
            continue;
          }
          const calls = buildJudgeCalls(found.job, found.row, found.answer);
          if (!calls.length) throw new Error(`"${found.answer.name}" has no checks or hand-scored dimensions to judge.`);
          const outs: string[] = [];
          for (let c = 0; c < calls.length; c++) {
            setJudging({ targets, index: i, call: c, calls: calls.length });
            const r = await api.judge(calls[c].prompt);
            outs.push(r.text);
          }
          update((s) => {
            const f = findAnswer(s, targets[i]);
            if (f) f.answer.judgeRuns[slot] = outs.join("\n\n");
          });
          added++;
        }
        setJudgeMessage({
          text:
            added || !full
              ? `Judge finished: ${added} run${added === 1 ? "" : "s"} added.` + (full ? ` ${full} answer(s) already had three runs.` : "")
              : "All three run slots are full. Clear one to run again.",
          error: false,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setJudgeMessage({
          text: `Judge stopped: ${msg}` + (added ? ` ${added} run(s) were saved before that.` : "") + " Run again to continue with the rest.",
          error: true,
        });
      } finally {
        setJudging(null);
      }
    },
    [update],
  );

  const value = useMemo<Store>(
    () => ({ state, update, ui, setUi, save, config, judging, judgeMessage, runJudge, flash }),
    [state, update, ui, setUi, save, config, judging, judgeMessage, runJudge, flash],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

/** The selected workstream and job, falling back to the first available. */
export function useCurrent(): { ws: Workstream | null; job: Job | null } {
  const { state, ui } = useStore();
  const ws = state.workstreams.find((w) => w.id === ui.wsId) ?? state.workstreams[0] ?? null;
  const job = ws ? (ws.jobs.find((j) => j.id === ui.jobId) ?? ws.jobs[0] ?? null) : null;
  return { ws, job };
}

/** Mutate the current job inside an update. */
export function useJobUpdate(): (fn: (job: Job, ws: Workstream) => void) => void {
  const { update } = useStore();
  const { job } = useCurrent();
  const id = job?.id;
  return useCallback(
    (fn) =>
      update((s) => {
        const f = findJob(s, id);
        if (f) fn(f.job, f.ws);
      }),
    [update, id],
  );
}
