import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { buildSuggestPrompt, parseSuggestion, type SuggestRequest } from "../src/shared/suggest";
import { complete, ModelError, modelConfig } from "./model";
import { StateStore } from "./storage";

const DATA_FILE = path.resolve(process.env.DATA_FILE ?? "data/state.json");
const PORT = Number(process.env.PORT ?? 8787);
const store = new StateStore(DATA_FILE);

export const app = express();
app.use(express.json({ limit: "25mb" }));

app.get("/api/config", (_req, res) => {
  const { hasKey, model } = modelConfig();
  res.json({ judgeReady: hasKey && Boolean(model), hasKey, model });
});

app.get("/api/state", async (_req, res) => {
  res.json(await store.load());
});

app.put("/api/state", async (req, res) => {
  const { state, baseRev } = req.body ?? {};
  if (typeof baseRev !== "number") return void res.status(400).json({ error: "baseRev is required" });
  const r = await store.save(state, baseRev);
  if (!r.ok)
    return void res
      .status(409)
      .json({ error: "The saved data changed in another tab or window. Reload to get the latest.", rev: r.rev });
  res.json({ rev: r.rev });
});

/** Run one judge prompt. Prompts are built in shared code so they can be shown and tested. */
app.post("/api/judge", async (req, res) => {
  const prompt = req.body?.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) return void res.status(400).json({ error: "prompt is required" });
  res.json({ text: await complete(prompt) });
});

app.post("/api/suggest", async (req, res) => {
  const body = req.body as Partial<SuggestRequest>;
  if (!body?.asks?.trim() || !Array.isArray(body.records) || !body.records.length)
    return void res.status(400).json({ error: "Add the question and at least one record first." });
  const draft = parseSuggestion(await complete(buildSuggestPrompt(body as SuggestRequest)));
  if (!draft) return void res.status(502).json({ error: "The model did not return usable suggestions. Try again." });
  res.json({ draft });
});

if (process.env.NODE_ENV === "production") {
  const dist = path.resolve("dist");
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ModelError) return void res.status(err.status).json({ error: err.message });
  if ((err as { status?: number }).status === 413) return void res.status(413).json({ error: "Request too large." });
  if ((err as { name?: string }).name === "ZodError")
    return void res.status(400).json({ error: "Data did not match the expected shape." });
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
});

app.listen(PORT, "127.0.0.1", () => {
  const { hasKey, model } = modelConfig();
  console.log(`Golden Table API on http://127.0.0.1:${PORT}  (data: ${DATA_FILE})`);
  if (!hasKey || !model) console.log("Judge disabled until ANTHROPIC_API_KEY and JUDGE_MODEL are set in .env");
});
