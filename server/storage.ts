import { promises as fs } from "node:fs";
import path from "node:path";
import { formatZodError, parseState } from "../src/shared/schema";
import { seedState } from "../src/shared/seed";
import type { AppState } from "../src/shared/types";

export interface Stored {
  state: AppState;
  /** Increments on every save; used to reject writes from a stale tab. */
  rev: number;
}

export class StateStore {
  private current: Stored | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly file: string) {}

  async load(): Promise<Stored> {
    if (this.current) return this.current;
    let raw: string | null = null;
    try {
      raw = await fs.readFile(this.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (raw === null) {
      this.current = { state: seedState(), rev: 1 };
      await this.write(this.current);
      console.log(`No state file found. Wrote example data to ${this.file}`);
      return this.current;
    }
    try {
      const parsed = JSON.parse(raw) as { rev?: number; state?: unknown };
      this.current = { state: parseState(parsed.state), rev: Number(parsed.rev) || 1 };
    } catch (e) {
      // Never overwrite a file we cannot read: move it aside and start from the seed.
      const aside = `${this.file}.unreadable-${Date.now()}`;
      await fs.rename(this.file, aside);
      console.error(`State file could not be read (${formatZodError(e)}). Moved it to ${aside} and started from example data.`);
      this.current = { state: seedState(), rev: 1 };
      await this.write(this.current);
    }
    return this.current;
  }

  /** Replace the whole state. Rejects if baseRev is not the latest revision. */
  save(state: unknown, baseRev: number): Promise<{ ok: true; rev: number } | { ok: false; rev: number }> {
    const run = async () => {
      const cur = await this.load();
      if (baseRev !== cur.rev) return { ok: false as const, rev: cur.rev };
      const next = { state: parseState(state), rev: cur.rev + 1 };
      await this.write(next);
      this.current = next;
      return { ok: true as const, rev: next.rev };
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Atomic write: temp file in the same directory, then rename over the target. */
  private async write(s: Stored): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ rev: s.rev, savedAt: new Date().toISOString(), state: s.state }, null, 2));
    await fs.rename(tmp, this.file);
  }
}
