import { z } from "zod";
import { uid } from "./ids";
import { DIM_KEYS, type AppState, type Job } from "./types";

const dimKey = z.enum(DIM_KEYS);
const dimOrEmpty = z.union([dimKey, z.literal("")]);
const ruleFeed = z.union([z.literal(""), z.literal("auto"), dimKey]);
const shareFeed = z.string().regex(new RegExp(`^share:(${DIM_KEYS.join("|")})$`)) as z.ZodType<`share:${(typeof DIM_KEYS)[number]}`>;

const line = z.object({ id: z.string().min(1), text: z.string() });
const ticks = z.record(z.string(), z.boolean());
const score = z.union([z.literal(0), z.literal(3), z.literal(5)]);

const dimSetting = z.object({
  used: z.boolean(),
  plainName: z.string().default(""),
  weight: z.number().min(0).max(100),
  whyNotUsed: z.string().default(""),
  s0: z.string().default(""),
  s3: z.string().default(""),
  s5: z.string().default(""),
});

const answer = z.object({
  id: z.string().min(1),
  name: z.string(),
  kind: z.enum(["Good", "Borderline", "Bad"]),
  set: z.enum(["Tuning", "Holdout"]),
  answer: z.string(),
  log: z.string().default(""),
  auto: ticks.default({}),
  checks: z.object({ S: ticks, W: ticks, N: ticks, U: ticks, A: ticks }),
  scores: z.partialRecord(dimKey, score).default({}),
  why: z.partialRecord(dimKey, z.string()).default({}),
  judgeRuns: z.tuple([z.string(), z.string(), z.string()]).default(["", "", ""]),
});

const row = z.object({
  id: z.string().min(1),
  label: z.string(),
  asks: z.string(),
  tests: z.string().default(""),
  status: z.enum(["Draft", "In review", "Approved"]),
  records: z.array(z.object({ id: z.string(), label: z.string(), text: z.string() })),
  mustSay: z.array(line),
  mustShow: z.array(line),
  mustNot: z.array(line),
  ifUnsure: z.array(line),
  allowed: z.array(line),
  answers: z.array(answer),
});

export const jobSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  reader: z.string().default(""),
  example: z.boolean().optional(),
  failures: z.array(z.object({ id: z.string(), text: z.string(), dimKey: dimOrEmpty })),
  dims: z.object(Object.fromEntries(DIM_KEYS.map((k) => [k, dimSetting])) as Record<(typeof DIM_KEYS)[number], typeof dimSetting>),
  feeds: z.object({
    say: dimOrEmpty,
    show: dimOrEmpty,
    not: ruleFeed,
    unsure: z.union([ruleFeed, shareFeed]),
    allowed: ruleFeed,
  }),
  autoFails: z.array(line),
  passMark: z.number().min(0).max(100).default(85),
  version: z.string().default(""),
  approvedBy: z.string().default(""),
  rows: z.array(row),
});

export const stateSchema = z.object({
  version: z.literal(1),
  workstreams: z.array(
    z.object({ id: z.string().min(1), code: z.string(), name: z.string(), jobs: z.array(jobSchema) }),
  ),
});

// Compile-time check that the schemas and the hand-written types agree.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _jobOk: Same<z.infer<typeof jobSchema>, Job> = true;
const _stateOk: Same<z.infer<typeof stateSchema>, AppState> = true;
void _jobOk;
void _stateOk;

export function parseState(data: unknown): AppState {
  return stateSchema.parse(data) as AppState;
}

/* ---------------- export / import ---------------- */

export const EXPORT_KIND = "golden-table-job";

export interface JobExport {
  kind: typeof EXPORT_KIND;
  version: 1;
  exportedAt: string;
  job: Job;
}

export function exportJob(job: Job, now = new Date()): JobExport {
  return { kind: EXPORT_KIND, version: 1, exportedAt: now.toISOString(), job: structuredClone(job) };
}

const exportSchema = z.object({ kind: z.literal(EXPORT_KIND), version: z.literal(1), job: jobSchema });

/**
 * Validate an exported job and give it fresh job/row/answer ids so it never
 * collides with existing data. Line ids are kept: answer ticks refer to them.
 * Accepts either the export wrapper or a bare job object.
 */
export function importJob(data: unknown, existingNames: string[] = []): Job {
  const wrapped = exportSchema.safeParse(data);
  const job = (wrapped.success ? wrapped.data.job : jobSchema.parse(data)) as Job;
  const copy = structuredClone(job);
  copy.id = uid();
  for (const r of copy.rows) {
    r.id = uid();
    for (const a of r.answers) a.id = uid();
  }
  if (existingNames.includes(copy.name)) copy.name = `${copy.name} (imported)`;
  return copy;
}

export function formatZodError(e: unknown): string {
  if (e instanceof z.ZodError)
    return e.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
  return e instanceof Error ? e.message : String(e);
}
