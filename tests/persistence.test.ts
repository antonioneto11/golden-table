import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../server/storage";
import { exportJob, importJob } from "../src/shared/schema";
import { seedState } from "../src/shared/seed";
import { buildSuggestPrompt, parseSuggestion } from "../src/shared/suggest";

const tmpFile = () => path.join(mkdtempSync(path.join(tmpdir(), "gts-")), "state.json");

describe("StateStore", () => {
  it("seeds on first load and survives a restart", async () => {
    const file = tmpFile();
    const a = new StateStore(file);
    const first = await a.load();
    expect(first.rev).toBe(1);
    first.state.workstreams[0].name = "Renamed";
    expect(await a.save(first.state, 1)).toEqual({ ok: true, rev: 2 });

    const b = new StateStore(file); // simulated restart
    const again = await b.load();
    expect(again.rev).toBe(2);
    expect(again.state.workstreams[0].name).toBe("Renamed");
  });

  it("rejects a save from a stale revision", async () => {
    const s = new StateStore(tmpFile());
    const { state } = await s.load();
    await s.save(state, 1);
    expect(await s.save(state, 1)).toEqual({ ok: false, rev: 2 });
  });

  it("rejects invalid state without touching the file", async () => {
    const file = tmpFile();
    const s = new StateStore(file);
    await s.load();
    const before = readFileSync(file, "utf8");
    await expect(s.save({ version: 1, workstreams: [{ nope: true }] }, 1)).rejects.toThrow();
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("moves an unreadable file aside instead of overwriting it", async () => {
    const file = tmpFile();
    writeFileSync(file, "{ not json");
    await new StateStore(file).load();
    const names = readdirSync(path.dirname(file));
    expect(names.some((n) => n.startsWith("state.json.unreadable-"))).toBe(true);
  });
});

describe("export / import", () => {
  it("round-trips a job through JSON with fresh ids and identical content", () => {
    const job = seedState().workstreams[0].jobs[1];
    const json = JSON.stringify(exportJob(job));
    const back = importJob(JSON.parse(json), ["Something else"]);
    expect(back.id).not.toBe(job.id);
    expect(back.rows[0].id).not.toBe(job.rows[0].id);
    expect(back.rows[0].answers[0].id).not.toBe(job.rows[0].answers[0].id);
    const strip = (j: typeof job) =>
      JSON.parse(JSON.stringify(j, (k, v) => (k === "id" && typeof v === "string" && v.length === 10 ? "*" : v)));
    // Line ids are kept so ticks still line up; job/row/answer ids are new.
    expect(back.rows[0].mustSay.map((l) => l.id)).toEqual(job.rows[0].mustSay.map((l) => l.id));
    expect({ ...strip(back), id: "*" }).toEqual({ ...strip(job), id: "*" });
  });

  it("marks a name clash and rejects malformed input", () => {
    const job = seedState().workstreams[0].jobs[0];
    expect(importJob(exportJob(job), [job.name]).name).toBe(`${job.name} (imported)`);
    expect(() => importJob({ kind: "golden-table-job", version: 1, job: { name: "x" } })).toThrow();
  });
});

describe("suggest", () => {
  it("builds a prompt from the question and records and parses the draft", () => {
    const p = buildSuggestPrompt({ jobName: "J", reader: "", tests: "t", asks: "What is open?", records: [{ id: "R1", label: "Note", text: "Body" }] });
    expect(p).toContain("[R1] Note\nBody");
    expect(parseSuggestion('```json\n{"mustSay":["  a  fact "],"mustShow":[],"mustNot":["x"],"ifUnsure":[],"allowed":[]}\n```')).toEqual({
      mustSay: ["a fact"],
      mustShow: [],
      mustNot: ["x"],
      ifUnsure: [],
      allowed: [],
    });
    expect(parseSuggestion("no")).toBeNull();
  });
});
