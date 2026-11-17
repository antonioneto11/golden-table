import express from "express";

const app = express();
app.get("/api/health", (_req, res) => res.json({ ok: true }));
const port = Number(process.env.PORT ?? 8787);
app.listen(port, "127.0.0.1", () => console.log(`API on http://127.0.0.1:${port}`));
