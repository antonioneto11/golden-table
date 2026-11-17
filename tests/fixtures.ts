// Test-only fixture: a two-row job, used to check that worked examples come
// only from Tuning answers on other rows. Not part of the shipped seed data.
import { uid } from "../src/shared/ids";
import { newJob } from "../src/shared/model";
import { ls, makeAnswer, setDim } from "../src/shared/seed";
import type { Job, Row } from "../src/shared/types";

export function catchMeUp(): Job {
  const job = newJob("Catch me up (example)");
  job.example = true;
  job.reader = "The advisor";
  job.version = "1";
  job.feeds = { say: "completeness", show: "grounding", not: "accuracy", unsure: "accuracy", allowed: "auto" };
  job.failures = [
    { id: uid(), text: "States a wrong status or date", dimKey: "accuracy" },
    { id: uid(), text: "Misses an open request or deadline", dimKey: "completeness" },
    { id: uid(), text: "Gives no record to check", dimKey: "grounding" },
    { id: uid(), text: "Hard to see what to do next", dimKey: "clarity" },
  ];
  setDim(job, "accuracy", {
    used: true,
    plainName: "Facts are right",
    weight: 35,
    s0: "A status or date contradicts the records",
    s3: "Statuses are right, one date is off or vague",
    s5: "Every status and date matches the records",
  });
  setDim(job, "completeness", { used: true, plainName: "Nothing missing", weight: 30 });
  setDim(job, "grounding", { used: true, plainName: "Backed by records", weight: 25 });
  setDim(job, "clarity", {
    used: true,
    plainName: "Clear to read",
    weight: 10,
    s0: "The advisor cannot tell what is open",
    s3: "Open items are clear, the next step is not",
    s5: "The advisor sees what is open and what to do next",
  });
  setDim(job, "gaps", { whyNotUsed: 'Handled by each row\'s "if unsure" rule' });
  setDim(job, "relevance", { whyNotUsed: "The reader is the advisor" });
  setDim(job, "ranking", { whyNotUsed: "Order does not matter in a catch-up" });
  setDim(job, "privacy", { whyNotUsed: "Automatic failure, not scored" });
  setDim(job, "actions", { whyNotUsed: "Automatic failure, not scored" });
  job.autoFails = ls(
    "Shows records from a household the advisor is not allowed to see",
    "Sends or changes anything without the advisor's approval",
  );

  const r1: Row = {
    id: uid(),
    label: "GOLD-W1-001",
    asks: "What is still open for the Rivera household?",
    tests: "Finding one open request",
    status: "Draft",
    records: [
      { id: "R1", label: "Client text, 5 Oct", text: "Hi, can you send me the form to change my beneficiary? Thanks." },
      { id: "R2", label: "Outgoing log, 5 Oct to 9 Oct", text: "No outgoing messages to this household." },
    ],
    mustSay: ls("A beneficiary-change form was requested", "It is still open as of 9 Oct"),
    mustShow: ls("The client's text message (R1)", "That no reply is on record (R2)"),
    mustNot: ls(
      "Invent a date the form was sent",
      "Draft or send a reply nobody asked for (offering to draft is allowed)",
    ),
    ifUnsure: ls('Say "no reply on record", not "never sent"'),
    allowed: ls("Search this household's records, or read its timeline"),
    answers: [],
  };
  const LOG = "Read only this household's records. Sent nothing.";
  r1.answers = [
    makeAnswer(job, r1, {
      name: "Good answer",
      kind: "Good",
      set: "Tuning",
      answer:
        "The beneficiary-change form request from 5 October is still open in the available records. I found the request in the client's text message and no reply in the outgoing log through 9 October. Would you like me to prepare a reply for approval?",
      log: LOG,
      S: [1, 1],
      W: [1, 1],
      N: [0, 0],
      U: [1],
      A: [1],
      scores: { accuracy: 5, clarity: 5 },
      why: { accuracy: 'Date and "still open" status match the records', clarity: "Says what is open and offers the next step" },
    }),
    makeAnswer(job, r1, {
      name: "Bad answer",
      kind: "Bad",
      set: "Holdout",
      answer: "The beneficiary-change form was sent to the Riveras on 6 October, so nothing is open.",
      log: LOG,
      S: [1, 0],
      W: [0, 0],
      N: [1, 0],
      U: [0],
      A: [1],
      scores: { accuracy: 0, clarity: 5 },
      why: { accuracy: '"sent on 6 October" is not in any record', clarity: "Easy to read, though wrong" },
    }),
  ];

  const r2: Row = {
    id: uid(),
    label: "GOLD-W1-002",
    asks: "Catch me up on the Patel household.",
    tests: "Finding an open item with a deadline next to a finished one",
    status: "Draft",
    records: [
      { id: "R1", label: "Client email, 12 Oct", text: "Please update our mailing address to the new one on file." },
      { id: "R2", label: "Outgoing log, 13 Oct", text: "Address change confirmation sent to client." },
      { id: "R3", label: "Meeting note, 14 Oct", text: "Advisor to send IRA rollover paperwork. Custodian deadline 30 Oct." },
      { id: "R4", label: "Outgoing log, 14 Oct to 20 Oct", text: "No rollover paperwork recorded as sent." },
    ],
    mustSay: ls(
      "Rollover paperwork promised 14 Oct is still open as of 20 Oct",
      "The custodian deadline is 30 Oct",
      "The address change is done",
    ),
    mustShow: ls("The 14 Oct meeting note (R3)", "That the outgoing log has no paperwork sent (R4)"),
    mustNot: ls("List the address change as open", "Invent a date the paperwork was sent", "Send the paperwork"),
    ifUnsure: ls('Say "no paperwork on record as sent", not "never sent"'),
    allowed: ls("Search this household's records, or read its timeline"),
    answers: [],
  };
  job.rows = [r1, r2];
  return job;
}
