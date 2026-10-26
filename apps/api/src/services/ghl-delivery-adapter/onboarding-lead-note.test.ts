import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildOnboardingLeadNote,
  isCombinedAgeDobLabel,
  isForbiddenOnboardingAnswerKey,
  listApprovedFormAnswers,
  reconstructOnboardingNoteBody,
  resolveGhlNoteBodyMaxChars,
  type OnboardingStoredLeadEvent,
} from "./onboarding-lead-note.js";

const EXPECTED_BODY = `Lead: Ada Lovelace
Phone: +15550100
Email: ada@example.com
State: TX
Date: 10/26/2026
Lead type: VET
Age: 47
DOB: 04/12/1979
Primary reason: Family
Primary concern: not supplied
Source: leadcapture go.example.com/alex
SA360 event: evt_note_v2

Form Questions and Answers
1. Primary Reason (was: Coverage Reason): Family
2. Age: 47
3. DOB: April 12, 1979
4. Military Status: (unanswered)
5. Beneficiary: Child
6. Beneficiary (2): Spouse
7. Desired Coverage: 25000; 50000`;

function evtNoteV2(): OnboardingStoredLeadEvent {
  return {
    sourceLeadEventId: "evt_note_v2",
    generatedAt: "2026-10-26T15:04:00.000Z",
    fullName: "Ada Lovelace",
    phone: "+15550100",
    email: "ada@example.com",
    state: "TX",
    leadType: "VET",
    sourceText: "leadcapture go.example.com/alex",
    sourceAttributes: {
      primary_reason: "Family",
      age: 47,
      date_of_birth: "1979-04-12",
      military_status: "",
      fbclid: "IwAR123",
    },
    schemaDrift: {
      possibleRenames: [
        { from: "Coverage Reason", to: "Primary Reason", canonical: "primary_reason" },
      ],
    },
    answerFields: [
      { key: "Primary Reason", value: "Family", canonicalKey: "primary_reason" },
      { key: "Age", value: "47", canonicalKey: "age" },
      { key: "DOB", value: "April 12, 1979", canonicalKey: "date_of_birth" },
      { key: "Military Status", value: "", canonicalKey: "military_status" },
      { key: "Beneficiary", value: "Child", canonicalKey: "beneficiary" },
      { key: "Beneficiary", value: "Spouse", canonicalKey: "beneficiary" },
      { key: "Desired Coverage", value: ["25000", "50000"], canonicalKey: "desired_coverage" },
      { key: "fbclid", value: "IwAR123", canonicalKey: "fbclid" },
      { key: "xxTrustedFormCertUrl", value: "https://cert.example/secret" },
      { key: "Age/ DOB", value: "should-not-merge" },
    ],
  };
}

test("evt_note_v2 matches the sa360_lead_note_v2 acceptance body", () => {
  const plan = buildOnboardingLeadNote({ event: evtNoteV2(), maxChars: 10_000 });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.contractVersion, "sa360_lead_note_v2");
  assert.equal(plan.title, "SA360 lead");
  assert.equal(plan.body, EXPECTED_BODY);
  assert.equal(plan.preview, EXPECTED_BODY);
  assert.equal(plan.posted, false);
  assert.equal(plan.status, "ready");
  assert.equal(plan.keptAnswerCount, 7);
  assert.equal(plan.parts.length, 1);
  assert.equal(plan.parts[0]?.title, "SA360 lead");
  assert.equal(plan.body.includes("fbclid"), false);
  assert.equal(plan.body.includes("IwAR123"), false);
  assert.equal(plan.body.includes("https://cert.example/secret"), false);
  assert.equal(plan.body.includes("Age/ DOB"), false);
  assert.equal(plan.body.includes("Healthcare Profession"), false);
  assert.equal(plan.body.includes("Primary Concern"), false);
  assert.match(plan.body, /Primary concern: not supplied/);
  assert.equal(plan.body.includes("Child; Spouse"), false);
  assert.equal(plan.answers[3]?.unanswered, true);
  assert.equal(plan.answers.some((answer) => answer.canonicalKey === "primary_concern"), false);
});

test("a test run line is inserted after the event line and changes nothing else", () => {
  const plan = buildOnboardingLeadNote({
    event: evtNoteV2(),
    testRunId: "run_1",
    maxChars: 10_000,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  const expected = EXPECTED_BODY.replace(
    "SA360 event: evt_note_v2\n\n",
    "SA360 event: evt_note_v2\nSA360 test run: run_1\n\n"
  );
  assert.equal(plan.body, expected);
  assert.equal(plan.parts[0]?.idempotencyKey, "onboarding-test:run_1:ghl-note:1");
  assert.equal(plan.parts[0]?.idempotencyKey.startsWith("ghl-note:"), false);
});

test("renames, duplicate labels, unanswered fields, and multiple choice stay in capture order", () => {
  const answers = listApprovedFormAnswers(evtNoteV2());
  assert.deepEqual(
    answers.map((answer) => answer.line),
    [
      "1. Primary Reason (was: Coverage Reason): Family",
      "2. Age: 47",
      "3. DOB: April 12, 1979",
      "4. Military Status: (unanswered)",
      "5. Beneficiary: Child",
      "6. Beneficiary (2): Spouse",
      "7. Desired Coverage: 25000; 50000",
    ]
  );
  assert.equal(answers[0]?.renamedFrom, "Coverage Reason");
  assert.equal(answers[5]?.label, "Beneficiary (2)");
});

test("meta field_data keeps duplicate labels and joins choices without walking the raw payload", () => {
  const answers = listApprovedFormAnswers({
    sourceLeadEventId: "evt_meta",
    metaFieldData: [
      { name: "Beneficiary", values: ["Child"] },
      { name: "Beneficiary", values: ["Spouse"] },
      { name: "Beneficiary", values: ["Parent"] },
      { name: "Desired Coverage", values: ["25000", "50000"] },
      { name: "fbclid", values: ["IwAR123"] },
      { name: "api_key", values: ["sekret"] },
    ],
  });
  assert.deepEqual(
    answers.map((answer) => `${answer.label}: ${answer.valueText}`),
    [
      "Beneficiary: Child",
      "Beneficiary (2): Spouse",
      "Beneficiary (3): Parent",
      "Desired Coverage: 25000; 50000",
    ]
  );
});

test("machine keys use the v3 header and do not copy primary reason into primary concern", () => {
  const answers = listApprovedFormAnswers({
    sourceLeadEventId: "evt_canonical",
    sourceAttributes: {
      primary_reason: "Family",
      age: 47,
      military_status: null,
    },
    unmappedSourceFields: [
      { key: "notes", value: "Call after 5" },
      { key: "xxTrustedFormCertUrl", value: "https://cert.example/secret" },
      { key: "utm_source", value: "facebook" },
    ],
  });
  assert.deepEqual(
    answers.map((answer) => answer.line),
    [
      "1. Primary Reason: Family",
      "2. Age: 47",
      "3. Military Status: (unanswered)",
      "4. notes: Call after 5",
    ]
  );
  const plan = buildOnboardingLeadNote({
    event: {
      sourceLeadEventId: "evt_canonical",
      sourceAttributes: { primary_reason: "Family", date_of_birth: "1979-04-12" },
    },
    maxChars: 10_000,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.match(plan.body, /Age: not supplied/);
  assert.match(plan.body, /DOB: 04\/12\/1979/);
  assert.match(plan.body, /Primary reason: Family/);
  assert.match(plan.body, /Primary concern: not supplied/);
  assert.equal(plan.body.includes("Healthcare Profession"), false);
});

test("missing and unparseable generation timestamps stay not supplied, and New York dates do not shift a calendar day", () => {
  const missing = buildOnboardingLeadNote({
    event: { sourceLeadEventId: "evt_date", generatedAt: null, fullName: "Ada Lovelace" },
    maxChars: 10_000,
  });
  assert.equal(missing.ok, true);
  if (!missing.ok) return;
  assert.match(missing.body, /Date: not supplied/);
  assert.match(missing.body, /Lead: Ada Lovelace/);

  const junk = buildOnboardingLeadNote({
    event: { sourceLeadEventId: "evt_date", generatedAt: "not-a-timestamp" },
    maxChars: 10_000,
  });
  assert.equal(junk.ok, true);
  if (!junk.ok) return;
  assert.match(junk.body, /Date: not supplied/);

  const previousEvening = buildOnboardingLeadNote({
    event: {
      sourceLeadEventId: "evt_date",
      generatedAt: "2026-10-26T03:30:00.000Z",
    },
    maxChars: 10_000,
  });
  assert.equal(previousEvening.ok, true);
  if (!previousEvening.ok) return;
  assert.match(previousEvening.body, /Date: 10\/25\/2026/);
});

test("answer newlines become one space and captured date text is not reformatted in the question block", () => {
  const answers = listApprovedFormAnswers({
    sourceLeadEventId: "evt_format",
    answerFields: [{ key: "DOB", value: "April 12, 1979\nmorning" }],
  });
  assert.equal(answers[0]?.valueText, "April 12, 1979 morning");
  assert.equal(answers[0]?.line.includes("\n"), false);
});

test("note overflow refuses without dropping the preview, and the cap env is honored", () => {
  const previous = process.env.SA360_GHL_NOTE_BODY_MAX_CHARS;
  process.env.SA360_GHL_NOTE_BODY_MAX_CHARS = "280";
  try {
    const refused = buildOnboardingLeadNote({
      event: evtNoteV2(),
      noteOverflow: "refuse",
    });
    assert.equal(refused.ok, true);
    if (!refused.ok) return;
    assert.ok(refused.body.length > 280);
    assert.equal(refused.status, "note_too_long");
    assert.equal(refused.error, "note_too_long");
    assert.equal(refused.posted, false);
    assert.equal(refused.preview, EXPECTED_BODY);
    assert.equal(refused.keptAnswerCount, 7);
    assert.deepEqual(refused.parts, []);
  } finally {
    if (previous === undefined) delete process.env.SA360_GHL_NOTE_BODY_MAX_CHARS;
    else process.env.SA360_GHL_NOTE_BODY_MAX_CHARS = previous;
  }
  assert.equal(resolveGhlNoteBodyMaxChars(undefined), 10_000);
  assert.equal(resolveGhlNoteBodyMaxChars("0"), 10_000);
  assert.equal(resolveGhlNoteBodyMaxChars("nope"), 10_000);
});

test("split continuation keeps every answer character and stays within the cap", () => {
  const long = `${"Q".repeat(300)} tail`;
  const event: OnboardingStoredLeadEvent = {
    ...evtNoteV2(),
    answerFields: [
      ...(evtNoteV2().answerFields ?? []),
      { key: "Long Note", value: long },
    ],
  };
  const plan = buildOnboardingLeadNote({
    event,
    noteOverflow: "split_continuation",
    maxChars: 280,
    testRunId: "run_1",
    clientAccountId: "onb_fixture_client",
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.status, "ready");
  assert.ok(plan.parts.length > 1);
  for (const part of plan.parts) {
    assert.ok(part.body.length <= 280);
    assert.equal(part.body.includes("..."), false);
    assert.equal(part.body.includes("…"), false);
    assert.equal(part.title, `SA360 lead (${part.part}/${plan.parts.length})`);
    assert.equal(part.idempotencyKey, `onboarding-test:run_1:ghl-note:${part.part}`);
  }
  assert.equal(reconstructOnboardingNoteBody(plan.parts), plan.body);
  assert.equal(plan.preview, plan.body);
  assert.ok(plan.body.includes(long.replace(/\n/g, " ")));
  for (const answer of plan.answers) {
    if (answer.unanswered) {
      assert.ok(plan.body.includes("(unanswered)"));
    } else {
      assert.ok(plan.body.includes(answer.valueText));
    }
  }
  assert.equal(plan.keptAnswerCount, plan.answers.length);
});

test("production idempotency keys use the part suffix only after part 1", () => {
  const plan = buildOnboardingLeadNote({
    event: evtNoteV2(),
    clientAccountId: "onb_fixture_client",
    noteOverflow: "split_continuation",
    maxChars: 280,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.parts[0]?.idempotencyKey, "ghl-note:onb_fixture_client:evt_note_v2");
  assert.equal(plan.parts[1]?.idempotencyKey, "ghl-note:onb_fixture_client:evt_note_v2:2");
});

test("a mismatched client id is refused before a note is built", () => {
  const plan = buildOnboardingLeadNote({
    event: { ...evtNoteV2(), clientAccountId: "other_client" },
    clientAccountId: "onb_fixture_client",
  });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.error, "client_account_mismatch");
  assert.equal(plan.posted, false);
});

test("forbidden keys and the combined age/dob label are recognized", () => {
  assert.equal(isForbiddenOnboardingAnswerKey("fbclid"), true);
  assert.equal(isForbiddenOnboardingAnswerKey("xxTrustedFormCertUrl"), true);
  assert.equal(isForbiddenOnboardingAnswerKey("trustedform_cert_url"), true);
  assert.equal(isForbiddenOnboardingAnswerKey("leadid_token"), true);
  assert.equal(isForbiddenOnboardingAnswerKey("api_key"), true);
  assert.equal(isForbiddenOnboardingAnswerKey("X-Ghl-Signature"), true);
  assert.equal(isForbiddenOnboardingAnswerKey("Primary Reason"), false);
  assert.equal(isCombinedAgeDobLabel("Age/ DOB"), true);
  assert.equal(isCombinedAgeDobLabel("Age/DOB"), true);
  assert.equal(isCombinedAgeDobLabel("Age / DOB"), true);
  assert.equal(isCombinedAgeDobLabel("Age"), false);
  assert.equal(isCombinedAgeDobLabel("DOB"), false);
});

test("the formatter source does not call the network or embed a workflow id", () => {
  const source = readFileSync(new URL("./onboarding-lead-note.ts", import.meta.url), "utf8");
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("ghlLiveJson"), false);
  assert.equal(source.includes("destinationWorkflowIdGhl"), false);
});
