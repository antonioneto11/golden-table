// End-to-end walk-through of the "done when" list against a production build.
// Needs Google Chrome installed. Uses a temp data file; never touches data/state.json.
// Run: npm run e2e
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const APP = process.env.APP_DIR ?? process.cwd();
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "golden-table-e2e");
mkdirSync(SHOTS, { recursive: true });
const PORT = 8790;
const URL = `http://127.0.0.1:${PORT}/`;
const DATA = path.join(mkdtempSync(path.join(tmpdir(), "gts-e2e-")), "state.json");
const log = (...a) => console.log("•", ...a);
let server;

function startServer() {
  server = spawn("npx", ["tsx", "server/index.ts"], {
    cwd: APP,
    env: { ...process.env, NODE_ENV: "production", PORT: String(PORT), DATA_FILE: DATA, ANTHROPIC_API_KEY: "", JUDGE_MODEL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  return new Promise((res) => server.stdout.on("data", (d) => String(d).includes("Golden Table API") && res()));
}
const stopServer = () => new Promise((res) => { server.on("exit", res); server.kill(); });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

async function noHScroll(where) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  if (w > 400) throw new Error(`Horizontal scroll at ${where}: scrollWidth ${w}`);
}
const tab = (name) => page.getByRole("tab", { name }).click();
const card = (heading) => page.locator("section.card").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
const saved = () => page.getByRole("status").filter({ hasText: /^Saved$/ }).first().waitFor();

try {
  await startServer();
  await page.goto(URL);
  await page.getByRole("heading", { name: "Golden Table Simulator" }).waitFor();
  await page.screenshot({ path: `${SHOTS}/01-seed-mobile.png`, fullPage: false });
  await noHScroll("seed job tab");

  // Walk every tab of the seeded "Draft a text reply" job at phone width.
  await page.getByRole("button", { name: "Draft a text reply (example)" }).click();
  for (const t of ["Dimensions", "Score guide", "Fail rules", "Golden rows", "Grade answers", "Judge check"]) {
    await tab(new RegExp(t));
    await noHScroll(`seed ${t}`);
  }
  await page.screenshot({ path: `${SHOTS}/02-seed-judge-tab.png`, fullPage: true });

  // ---- Create a job from scratch ----
  await page.getByRole("button", { name: "+ Job" }).click();
  await page.getByLabel("Job (use case)").fill("Summarize a meeting");
  for (const [i, text, dim] of [[1, "States a wrong date", "accuracy"], [2, "Leaves out a decision", "completeness"], [3, "Hard to scan", "clarity"]]) {
    await page.getByRole("button", { name: "Add a failure" }).click();
    await page.getByLabel(`Failure ${i}`, { exact: true }).fill(text);
    await page.getByLabel(`Dimension for failure ${i}`).selectOption(dim);
  }
  await page.getByRole("button", { name: "Add mapped dimensions to the rubric" }).click();
  await page.getByText("Added Accuracy, Completeness, Clarity").waitFor();
  log("job created, dimensions mapped");

  await tab(/Dimensions/);
  for (const [name, w] of [["Accuracy", "50"], ["Completeness", "30"], ["Clarity", "20"]]) {
    await card(name).getByLabel("Weight").fill(w);
  }
  await page.locator(".sticky").getByText("Adds up").waitFor();
  await noHScroll("new dims");
  log("weights total 100");

  await tab(/Score guide/);
  await page.getByLabel('"Must say" checks score').selectOption("completeness");
  await page.getByLabel('Breaking a "Must not do" rule (answer did it)').selectOption("auto");
  await card("Accuracy").getByLabel("0 means").fill("A date or decision is wrong");
  await card("Accuracy").getByLabel("3 means").fill("Right but vague");
  await card("Accuracy").getByLabel("5 means").fill("Everything matches the notes");
  await card("Clarity").getByLabel("5 means").fill("Scannable in ten seconds");
  await page.getByText("Scored from checks").waitFor();

  await tab(/Golden rows/);
  await page.getByRole("button", { name: "Add a row" }).click();
  await page.getByLabel("The user asks").fill("Summarize my 12 Nov meeting with the Chen family.");
  await page.getByRole("button", { name: "Add a record" }).click();
  await page.getByLabel("Record R1 source and date").fill("Meeting note, 12 Nov");
  await page.getByLabel("Record R1 text").fill("Agreed to raise monthly savings to $1,500 from January. Next review 3 Mar.");
  const sayField = page.locator(".field").filter({ has: page.locator(".flabel", { hasText: /^Must say$/ }) });
  await sayField.getByRole("button", { name: "Add line" }).click();
  await page.getByLabel("Must say S1").fill("Savings rise to $1,500 a month");
  await page.getByLabel("Must say S1").press("Enter");
  await page.getByLabel("Must say S2").fill("Next review is 3 Mar");
  const notField = page.locator(".field").filter({ has: page.locator(".flabel", { hasText: /^Must not do$/ }) });
  await notField.getByRole("button", { name: "Add line" }).click();
  await page.getByLabel("Must not do N1").fill("Invent an amount or date");
  await noHScroll("row editor");
  await page.screenshot({ path: `${SHOTS}/03-row-editor.png`, fullPage: true });
  log("row added with record and checks");

  // ---- Grade three answers ----
  await page.getByRole("button", { name: "Grade answers for this row" }).click();
  const yesNo = async (id, v) => page.locator(".chk").filter({ hasText: id }).getByRole("button", { name: v, exact: true }).click();
  const score = async (dim, v) => page.getByRole("group", { name: `Score for ${dim}` }).getByRole("button", { name: v, exact: true }).click();
  const answers = [
    { text: "Savings go to $1,500/month from January; next review 3 Mar.", S: ["Yes", "Yes"], N: "No", acc: "5", cl: "5" },
    { text: "You agreed to save more starting January.", S: ["Yes", "No"], N: "No", acc: "3", cl: "3" },
    { text: "Savings rise to $2,000/month; next review 3 Mar.", S: ["No", "Yes"], N: "Yes", acc: "0", cl: "5" },
  ];
  for (const a of answers) {
    await page.getByRole("button", { name: "+ Answer" }).click();
    await page.getByLabel("Answer from the assistant").fill(a.text);
    await yesNo("S1", a.S[0]);
    await yesNo("S2", a.S[1]);
    await yesNo("N1", a.N);
    await score("Accuracy", a.acc);
    await score("Clarity", a.cl);
  }
  await noHScroll("grade tab");
  const verdictOf = async (name) => {
    await page.getByRole("button", { name, exact: true }).click();
    return (await card("Your result").locator(".verdict .pill").innerText()).trim();
  };
  const v = [await verdictOf("Answer 1"), await verdictOf("Answer 2"), await verdictOf("Answer 3")];
  log("human verdicts:", v.join(" | "));
  if (!(v[0] === "Pass, 100" && v[1] === "Fail, 57" && v[2] === "Fail, automatic")) throw new Error("Unexpected human verdicts " + v);

  // Stable ids: editing S1's text must not change Answer 2's ticks.
  await tab(/Golden rows/);
  await page.getByLabel("Must say S1").fill("Monthly savings rise to $1,500");
  await tab(/Grade answers/);
  if ((await verdictOf("Answer 2")) !== "Fail, 57") throw new Error("Ticks shifted after editing a line");
  log("editing a check line kept ticks");

  // ---- Judge: no key on this server, so enter a run by hand ----
  await page.getByRole("button", { name: "Answer 2", exact: true }).click();
  await page.getByText("Set ANTHROPIC_API_KEY and JUDGE_MODEL").first().waitFor();
  const judgeOut =
    'Sure, here you go:\n```json\n{"checks":{"S1":{"why":"says save more","yes":true},"S2":{"why":"mentions review","yes":true},"N1":{"why":"none","yes":false}}}\n```\n' +
    '{"scores":{"accuracy":{"why":"fine","score":5}}}\n{"scores":{"clarity":{"why":"short","score":5}}}';
  await page.getByText("Advanced: add a judge result by hand").click();
  await page.getByLabel("Judge result to add").fill(judgeOut);
  await page.getByRole("button", { name: "Add this result" }).click();
  await page.getByText("False pass").first().waitFor();
  await page.screenshot({ path: `${SHOTS}/04-judge-run.png`, fullPage: true });

  await tab(/Judge check/);
  await page.getByText("Judge differs on").waitFor();
  const diffText = await page.locator("ul.diff").first().innerText();
  log("judge differs on:\n   " + diffText.replace(/\n/g, "\n   "));
  for (const want of ["S2", "you No, judge Yes", "Accuracy", "you 3, judge 5"]) if (!diffText.includes(want)) throw new Error("Missing diff " + want);
  const pills = await page.locator("section.card .summary").first().innerText();
  log("metrics:", pills.replace(/\n/g, " | "));
  await noHScroll("judge tab");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: `${SHOTS}/05-judge-tab-dark.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });
  await saved();

  // ---- Restart the server: state must survive ----
  await stopServer();
  await startServer();
  await page.reload();
  await page.getByRole("button", { name: "Summarize a meeting" }).click();
  await tab(/Judge check/);
  await page.getByText("False pass").first().waitFor();
  log("state survived a server restart");

  // ---- Export and import round trip ----
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save job as file" }).click()]);
  const file = path.join(path.dirname(DATA), "export.json");
  await dl.saveAs(file);
  const exported = JSON.parse(readFileSync(file, "utf8"));
  log("saved file:", dl.suggestedFilename(), "|", exported.kind, exported.job.name, `${exported.job.rows[0].answers.length} answers`);
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByText('Opened "Summarize a meeting (imported)"').waitFor();
  await tab(/Judge check/);
  const pillsImported = await page.locator("section.card .summary").first().innerText();
  if (pillsImported !== pills) throw new Error(`Imported metrics differ:\n${pillsImported}\nvs\n${pills}`);
  log("import gives identical metrics");

  // Bad import shows an error, not a crash.
  const bad = path.join(path.dirname(DATA), "bad.json");
  (await import("node:fs")).writeFileSync(bad, '{"kind":"golden-table-job","version":1,"job":{"name":1}}');
  await page.locator('input[type="file"]').setInputFiles(bad);
  await page.getByText("isn't a Golden Table job file").waitFor();
  log("malformed import rejected with a message");

  await saved();
  const disk = JSON.parse(readFileSync(DATA, "utf8"));
  log("on disk: rev", disk.rev, "jobs", disk.state.workstreams.flatMap((w) => w.jobs.map((j) => j.name)).join(", "));
  if (errors.length) throw new Error("Browser errors:\n" + errors.join("\n"));
  log("PASS");
} catch (e) {
  await page.screenshot({ path: `${SHOTS}/zz-failure.png`, fullPage: true }).catch(() => {});
  console.error("FAIL:", e.message);
  if (errors.length) console.error("Browser errors:", errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  await stopServer().catch(() => {});
}
