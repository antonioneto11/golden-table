# Golden Table Simulator

A local web app for designing evaluation rubrics and golden test cases for an AI assistant, grading sample answers by hand, and then testing an LLM judge against those grades.

It walks one job through seven steps: **Job and failures → Dimensions → Score guide → Fail rules → Golden rows → Grade answers → Judge check**.

## Setup

Requires Node 20 or newer.

```bash
npm install
cp .env.example .env      # then fill in ANTHROPIC_API_KEY
npm run dev               # API on :8787, app on http://localhost:5173
```

On first start the server writes `data/state.json` with an example workstream. Delete that file to get the examples back.

For a single-process build: `npm run build && npm start`, then open http://127.0.0.1:8787.

### Environment variables

These are read by the server only and never sent to the browser.

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | For the judge | Key used for judge calls and "Suggest checks". |
| `JUDGE_MODEL` | For the judge | Model id, e.g. `claude-opus-5-5`. |
| `PORT` | No | API port (default `8787`). The Vite dev server proxies `/api` to it. |
| `DATA_FILE` | No | Path to the state file (default `data/state.json`). |

Without a key and model the app still works fully. You can paste judge output by hand, and the run buttons explain what's missing. Don't give the key a `VITE_` prefix, because that would bundle it into the browser code.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API and Vite dev server with reload. |
| `npm test` | Unit tests: scoring, judge prompts, parser, agreement, storage, export/import. |
| `npm run typecheck` | `tsc --noEmit` across client, server and tests. |
| `npm run e2e` | Builds the app, then drives it in headless Google Chrome at 400px width. It creates a job, adds a row, grades three answers, enters a judge run, checks the differences, restarts the server and round-trips export/import. It uses a temporary data file and needs Chrome installed. |

## Data

- All state lives in one JSON file, `data/state.json`. The app autosaves about 0.4s after your last edit, and the save indicator in the header shows the status.
- Writes are atomic: a temp file is written, then renamed over the old one. Each save carries a revision number. If another tab saved first, the server refuses the stale write and the app asks you to reload, so it never silently overwrites.
- If the file can't be read, it is moved aside to `state.json.unreadable-<time>` rather than overwritten.
- **Export job** downloads one job as JSON. **Import job** always adds it as a new job in the current workstream, with fresh ids and an "(imported)" suffix on name clashes. Nothing is overwritten.
- `data/*.json` is git-ignored. The example households and records are invented.

## Scoring rules

Both your grades and the judge's go through one pure function, `grade()` in `src/shared/scoring.ts`.

**Dimensions.** A job uses 3 to 5 of the 14 classic dimensions, and their weights should total 100. Speed and cost is never scored; it's reported separately.

**Check groups.** Each golden row has five groups of yes/no checks, one check per line. Every line has a stable id, so editing, deleting or reordering one line never moves the ticks on the others.

| Group | Question | Broken when |
|---|---|---|
| **S** Must say | Does the answer say this? | (not a rule) |
| **W** Must show | Does the answer point to this? | (not a rule) |
| **N** Must not do | Did the answer do this? | **Yes** |
| **U** If unsure | Did the answer follow this rule? | **No** |
| **A** Allowed ways | Did the agent stay within this? (code check) | **No** |

**Feeds** (set per job in Score guide) decide what each group does:

- `say` / `show` → a dimension, which is then scored **5 × met ÷ total** over that group's lines. If several groups feed one dimension, their lines are pooled.
- `unsure` → `share:<dim>` scores a dimension the same way, by share followed.
- `not` / `unsure` / `allowed` → `auto` fails the answer if any line is broken, or `<dim>` sets that dimension to **0** if any line is broken.
- `""` → no effect. A group with no effect isn't required for a verdict.

**Hand scores.** Any used dimension that no group feeds is scored by hand on **0, 3 or 5** only, with a one-line reason. If a row has no lines in a dimension's feeding group, that dimension falls back to a hand score for that row.

**Points.** Each dimension earns score ÷ 5 × weight points, and the total is the sum over used dimensions.

**Verdict**, in this order:

1. **Fail** if any automatic failure is ticked, or a group wired to `auto` is broken.
2. **Unfinished** if any required check (a line in a group that has an effect) or hand score is missing. The app lists what is still missing.
3. Otherwise, **pass** when total ≥ pass mark (default 85), else **fail**.

A dimension set to 0 by a broken rule needs no hand score. Weights that don't total 100 still produce a verdict, with a warning.

## The judge

- **Calls:** one call covers all yes/no checks in S, W, N and U, plus one call per hand-scored dimension. Group A and the automatic failures are code checks and are never sent; judge runs reuse your A ticks and automatic-failure ticks.
- **Prompt contents:** the question, the full records, the checks (or the 0/3/5 scale), and the answer with its action log. Each prompt asks for the reason first, then yes/no or the score. Prompts never include weights or the pass mark. **Show the exact prompts** under each answer displays them word for word.
- **Worked examples:** only from **Tuning** answers on **other** rows. **Holdout answers never appear in a prompt**, and this is covered by a test.
- **Output format:** JSON, `{"checks":{"S1":{"why":"…","yes":true}}}` or `{"scores":{"clarity":{"why":"…","score":3}}}`. Parsing is tolerant: it handles code fences, surrounding prose, several objects, and `"yes"`/`"no"` strings. Scores other than 0, 3 or 5 are shown as warnings and ignored.
- **Runs:** each answer has up to three run slots. **Run judge** fills the next empty slot for one answer. **Run all** judges every graded answer that has no run yet, and **Add a repeat run** adds one more to each. Progress is shown per answer. If a call fails, the run stops with the reason, and runs already finished are kept.
- **Pasting by hand:** you can paste judge output into any slot, for example from another model.
- **Line mapping:** runs made in the app record which line each S1/N2 meant at that moment, so later line edits don't shift them. Pasted runs are read by position against the current lines.

## Agreement metrics (Judge check)

These count only answers where your verdict is pass or fail, compared with the judge's first run that reached a verdict:

- verdict agreement, overall and split by Tuning and Holdout
- false passes (judge pass, you fail) and false fails
- average point gap
- single-check agreement, covering every S/W/N/U check and hand score you both answered
- repeat stability: whether answers with two or more runs got the same verdict every time

Suggested bar before trusting a judge: 20 or more graded answers, no false passes, and 9 in 10 agreement on Holdout.

## Layout

```
src/shared/   types, dimensions, scoring, judge prompts and parser, agreement, schema, seed data
src/client/   React app (store with autosave, one file per tab)
server/       Express API: state file, /api/judge, /api/suggest
tests/        Vitest unit tests
e2e/          headless Chrome walk-through (npm run e2e)
```
