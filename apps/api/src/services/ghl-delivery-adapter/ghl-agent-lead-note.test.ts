import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { COMPANY_SHEETS_V3_COLUMNS } from "@sa360/shared";

import { buildAgentGhlLeadNote, formatAgentGhlLeadNote } from "./ghl-agent-lead-note.js";
import { planIntakeSummaryNote, retryDecision } from "./vet-ghl-delivery-contract.js";
import type { OnboardingStoredLeadEvent } from "./onboarding-lead-note.js";

const COVERAGE = "$5,000 \u2013 $10,000";
const CALL_WINDOW = "Evening (5pm \u2013 8pm)";
const REASON = "Cover Funeral & Burial Expenses";

const STEVE_NOTE = `KEY INFO:
Lead: Steve Test
Phone: +19193003939
Email: stevetest@gmail.com
State: Alabama
DOB: 02/20/1968
Sex: Male
Marital Status: Married
Desired Coverage: ${COVERAGE}
Beneficiary: Spouse
Time to Call: ${CALL_WINDOW}
Primary Reason: ${REASON}
Military Status: Veteran (Honorably Discharged)
Branch of Service: Army`;

function steveEvent(): OnboardingStoredLeadEvent {
  return {
    sourceLeadEventId: "6f1c2a40-7b8e-4d11-9a22-stevetest0001",
    clientAccountId: "client_delivery_1",
    generatedAt: "2026-11-18T18:04:00.000Z",
    fullName: "Steve Test",
    phone: "+19193003939",
    email: "stevetest@gmail.com",
    state: "Alabama",
    leadType: "VET",
    sourceText: "leadcapture go.example.com/steve",
    sourceAttributes: {
      date_of_birth: "1968-02-20",
      sex: "Male",
      marital_status: "Married",
      desired_coverage: COVERAGE,
      beneficiary: "Spouse",
      best_time_to_call: CALL_WINDOW,
      primary_reason: REASON,
      military_status: "Veteran (Honorably Discharged)",
      branch_of_service: "Army",
      age: null,
      primary_concern: "",
      phone_verified: true,
      email_verified: "true",
      ip_address: "203.0.113.10",
      user_agent: "Mozilla/5.0",
      fbclid: "IwAR123",
      placement: "feed",
    },
    answerFields: [
      { key: "email", value: "stevetest@gmail.com" },
      { key: "phone_number", value: "+19193003939" },
      { key: "DOB", value: "02/20/1968", canonicalKey: "date_of_birth" },
      { key: "birthday", value: "February 20, 1968" },
      { key: "date", value: "11/18/2026" },
      { key: "appointment_date", value: "11/19/2026" },
      { key: "Military Status", value: "", canonicalKey: "military_status" },
      { key: "Primary Concern", value: "(unanswered)", canonicalKey: "primary_concern" },
      { key: "gender", value: "Male" },
      { key: "annual_income", value: "80000" },
      { key: "favorite_color", value: "blue" },
      { key: "anura_result", value: "suspect" },
      { key: "anura_response_id", value: "anura_123" },
      { key: "session_recording_url", value: "https://rec.example/secret" },
      { key: "resume_url", value: "https://resume.example/secret" },
      { key: "ttp", value: "ttp_token" },
      { key: "ttclid", value: "ttclid_token" },
      { key: "phone_verified", value: "true" },
      { key: "email_verified", value: "true" },
      { key: "ip_address", value: "203.0.113.10" },
      { key: "user_agent", value: "Mozilla/5.0" },
      { key: "fbclid", value: "IwAR123" },
      { key: "utm_source", value: "facebook" },
      { key: "source_lead_event_id", value: "6f1c2a40-7b8e-4d11-9a22-stevetest0001" },
      { key: "delivery_id", value: "dlv_steve_1" },
      { key: "xxTrustedFormCertUrl", value: "https://cert.example/secret" },
    ],
  };
}

test("a veteran lead note keeps identity first and only the answered insurance questions", () => {
  const body = formatAgentGhlLeadNote({ event: steveEvent() });
  assert.equal(body, STEVE_NOTE);
  assert.equal(body.includes("not supplied"), false);
  assert.equal(body.includes("(unanswered)"), false);
  assert.equal(body.includes("undefined"), false);
  assert.equal(body.includes("null"), false);
  assert.equal(body.includes("SA360 event"), false);
  assert.equal(body.includes("6f1c2a40-7b8e-4d11-9a22-stevetest0001"), false);
  assert.equal(body.includes("dlv_steve_1"), false);
  assert.equal(body.includes("203.0.113.10"), false);
  assert.equal(body.includes("Mozilla"), false);
  assert.equal(body.includes("IwAR123"), false);
  assert.equal(body.includes("anura"), false);
  assert.equal(body.includes("session_recording_url"), false);
  assert.equal(body.includes("https://rec.example/secret"), false);
  assert.equal(body.includes("resume.example"), false);
  assert.equal(body.includes("ttp_token"), false);
  assert.equal(body.includes("ttclid_token"), false);
  assert.equal(body.includes("facebook"), false);
  assert.equal(body.includes("cert.example"), false);
  assert.equal(body.includes("11/18/2026"), false);
  assert.equal(body.includes("11/19/2026"), false);
  assert.equal(body.includes("annual_income"), false);
  assert.equal(body.includes("80000"), false);
  assert.equal(body.includes("favorite_color"), false);
  assert.equal(body.includes("blue"), false);
  assert.equal(body.includes("Age:"), false);
  assert.equal(body.includes("Primary Concern"), false);
  assert.equal(body.includes("Lead type"), false);
  assert.equal(body.includes("Form Questions"), false);
  assert.equal(body.split("\n").filter((line) => line.startsWith("DOB:")).length, 1);
  assert.equal(body.split("\n").filter((line) => line.startsWith("Email:")).length, 1);
  assert.equal(body.split("\n").filter((line) => line.startsWith("Phone:")).length, 1);
  assert.equal(body.split("\n").filter((line) => line.startsWith("Sex:")).length, 1);
});

test("missing optional fields are omitted instead of filled with placeholders", () => {
  const body = formatAgentGhlLeadNote({
    event: {
      sourceLeadEventId: "evt_sparse",
      fullName: "Steve Test",
      phone: "  ",
      email: "null",
      state: "undefined",
      sourceAttributes: {
        primary_reason: REASON,
        military_status: "",
        beneficiary: "(unanswered)",
        sex: "not supplied",
        date_of_birth: null,
      },
    },
  });
  assert.equal(body, `KEY INFO:\nLead: Steve Test\nPrimary Reason: ${REASON}`);
});

test("date of birth uses the canonical value and reviewed aliases, and ignores unrelated dates", () => {
  const iso = formatAgentGhlLeadNote({
    event: {
      sourceLeadEventId: "evt_dob_iso",
      sourceAttributes: { date_of_birth: "1968-02-20" },
    },
  });
  assert.equal(iso, "KEY INFO:\nDOB: 02/20/1968");

  const datetime = formatAgentGhlLeadNote({
    event: {
      sourceLeadEventId: "evt_dob_datetime",
      sourceAttributes: { date_of_birth: "1968-02-20T03:30:00.000Z" },
    },
  });
  assert.equal(datetime, "KEY INFO:\nDOB: 02/20/1968");

  const monthName = formatAgentGhlLeadNote({
    event: {
      sourceLeadEventId: "evt_dob_month",
      answerFields: [{ key: "birthDate", value: "February 20, 1968" }],
    },
  });
  assert.equal(monthName, "KEY INFO:\nDOB: 02/20/1968");

  const already = formatAgentGhlLeadNote({
    event: {
      sourceLeadEventId: "evt_dob_us",
      answerFields: [{ key: "dob", value: "2/5/1968" }],
    },
  });
  assert.equal(already, "KEY INFO:\nDOB: 02/05/1968");

  const unrelated = formatAgentGhlLeadNote({
    event: {
      sourceLeadEventId: "evt_dob_unrelated",
      answerFields: [
        { key: "date", value: "11/18/2026" },
        { key: "appointment_date", value: "March 1, 2026" },
        { key: "submitted_at", value: "2026-11-18T18:04:00.000Z" },
      ],
    },
  });
  assert.equal(unrelated, "KEY INFO:");

  const notPromoted = formatAgentGhlLeadNote({
    event: {
      sourceLeadEventId: "evt_dob_override",
      answerFields: [{ key: "date", value: "02/20/1968" }],
    },
    routeAliasOverrides: { date_of_birth: ["date"] },
  });
  assert.equal(notPromoted, "KEY INFO:");

  const scoped = formatAgentGhlLeadNote({
    event: {
      sourceLeadEventId: "evt_dob_scoped",
      answerFields: [{ key: "date", value: "02/20/1968" }],
    },
    scopedBinding: {
      id: "leadcapture_test_date",
      provider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      aliases: { date: "date_of_birth" },
    },
  });
  assert.equal(scoped, "KEY INFO:\nDOB: 02/20/1968");

  const invalidKept = formatAgentGhlLeadNote({
    event: {
      sourceLeadEventId: "evt_dob_invalid",
      sourceAttributes: { date_of_birth: "not-a-date" },
    },
  });
  assert.equal(invalidKept, "KEY INFO:\nDOB: not-a-date");
});

test("duplicate contact fields and duplicate DOB values collapse to one line", () => {
  const body = formatAgentGhlLeadNote({
    event: {
      sourceLeadEventId: "evt_dup",
      fullName: "Steve Test",
      firstName: "Steven",
      lastName: "Testing",
      phone: "+19193003939",
      email: "stevetest@gmail.com",
      state: "Alabama",
      sourceAttributes: {
        date_of_birth: "1968-02-20",
        sex: "Male",
      },
      answerFields: [
        { key: "name", value: "Someone Else" },
        { key: "email_address", value: "other@example.com" },
        { key: "phone", value: "+10000000000" },
        { key: "state_of_residence", value: "AL" },
        { key: "sex", value: "M" },
        { key: "DOB", value: "02/20/1968" },
        { key: "birthday", value: "February 20, 1968" },
        { key: "birth_day", value: "20 February 1968" },
      ],
    },
  });
  assert.equal(
    body,
    `KEY INFO:
Lead: Steve Test
Phone: +19193003939
Email: stevetest@gmail.com
State: Alabama
DOB: 02/20/1968
Sex: Male`
  );
});

test("other niches include answered qualification questions and skip empty niche fields", () => {
  const body = formatAgentGhlLeadNote({
    event: {
      sourceLeadEventId: "evt_nurse",
      fullName: "Nia Nurse",
      leadType: "NURSE",
      sourceAttributes: {
        marital_status: "Single",
        healthcare_profession: "RN",
        homeowner: "Yes",
        military_status: null,
        branch_of_service: "  ",
        desired_coverage: ["$25,000", "$50,000"],
        applied_for_other_insurance: "no",
        age: 47,
      },
      unmappedSourceFields: [
        { key: "rig_type", value: "" },
        { key: "please_select_your_desired_coverage_amount", value: "$25,000" },
        { key: "Disability Rating", value: "70%" },
      ],
    },
  });
  assert.equal(
    body,
    `KEY INFO:
Lead: Nia Nurse
Marital Status: Single
Desired Coverage: $25,000; $50,000
Disability Rating: 70%
Healthcare Profession: RN
Homeowner: Yes
Applied for Other Insurance: no
Age: 47`
  );
  assert.equal(body.includes("Military Status"), false);
  assert.equal(body.includes("Branch of Service"), false);
  assert.equal(body.includes("Rig Type"), false);
  const headers = new Map(COMPANY_SHEETS_V3_COLUMNS.map((column) => [column.sourceField, column.header]));
  assert.equal(headers.get("healthcare_profession"), "Healthcare Profession");
  assert.equal(body.includes("Healthcare Profession: RN"), true);
});

test("HTML in an answer is escaped and a long note stays within the posting cap", () => {
  const hostile = `Spouse <script>alert("x")</script> & child`;
  const escaped = formatAgentGhlLeadNote({
    event: {
      sourceLeadEventId: "evt_html",
      fullName: "Ada <b>Lovelace</b>",
      sourceAttributes: {
        beneficiary: hostile,
        primary_reason: "Cover Funeral & Burial Expenses",
      },
    },
  });
  assert.equal(escaped.includes("<script>"), false);
  assert.equal(escaped.includes("<b>"), false);
  assert.equal(escaped.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"), true);
  assert.equal(escaped.includes("Ada &lt;b&gt;Lovelace&lt;/b&gt;"), true);
  assert.equal(escaped.includes("Cover Funeral & Burial Expenses"), true);
  assert.equal(escaped.includes("\n\n"), false);

  const newline = formatAgentGhlLeadNote({
    event: {
      sourceLeadEventId: "evt_newline",
      answerFields: [{ key: "primary_reason", value: "Cover Funeral\n& Burial Expenses" }],
    },
  });
  assert.equal(newline.includes("\nPrimary Reason: Cover Funeral & Burial Expenses"), true);
  assert.equal(newline.split("\n").length, 2);

  const longValue = `Q${"x".repeat(400)}`;
  const refused = buildAgentGhlLeadNote({
    event: {
      sourceLeadEventId: "evt_long",
      fullName: "Steve Test",
      sourceAttributes: { primary_reason: longValue },
    },
    maxChars: 80,
    noteOverflow: "refuse",
  });
  assert.equal(refused.status, "note_too_long");
  assert.equal(refused.parts.length, 0);
  assert.ok(refused.body.length > 80);
  assert.equal(refused.body.includes(longValue), true);

  const split = buildAgentGhlLeadNote({
    event: {
      sourceLeadEventId: "evt_long",
      fullName: "Steve Test",
      sourceAttributes: { primary_reason: longValue },
    },
    maxChars: 80,
    noteOverflow: "split_continuation",
  });
  assert.equal(split.status, "ready");
  assert.ok(split.parts.length > 1);
  for (const part of split.parts) assert.ok(part.body.length <= 80);
  let rebuilt = "";
  split.parts.forEach((part, index) => {
    if (index > 0 && !part.continuesLine) rebuilt += "\n";
    rebuilt += part.body;
  });
  assert.equal(rebuilt, split.body);

  const blocked = planIntakeSummaryNote({
    enabled: true,
    sourceLeadEventId: "evt_long",
    firstName: "Steve",
    lastName: "Test",
    sourceAttributes: { primary_reason: longValue },
    idempotencyKey: "run_long",
    maxChars: 80,
  });
  assert.deepEqual(blocked, { enabled: true, error: "note_too_long" });
});

test("intake-summary delivery keeps one idempotency key across retries", () => {
  const input = {
    enabled: true as const,
    sourceLeadEventId: "evt_steve",
    clientAccountId: "client_1",
    firstName: "Steve",
    lastName: "Test",
    phone: "+19193003939",
    email: "stevetest@gmail.com",
    state: "Alabama",
    leadType: "VET",
    sourceAttributes: steveEvent().sourceAttributes,
    answerFields: steveEvent().answerFields,
    idempotencyKey: "run_steve",
  };
  const first = planIntakeSummaryNote(input);
  const second = planIntakeSummaryNote(input);
  assert.equal("plan" in first && "plan" in second, true);
  if (!("plan" in first) || !("plan" in second)) return;
  assert.equal(first.plan.body, STEVE_NOTE);
  assert.equal(second.plan.body, first.plan.body);
  assert.equal(first.plan.parts.length, 1);
  assert.equal(first.plan.parts[0]?.idempotencyKey, "run_steve:note:1");
  assert.equal(second.plan.parts[0]?.idempotencyKey, first.plan.parts[0]?.idempotencyKey);
  assert.equal(first.plan.posted, false);
  assert.equal(
    retryDecision({
      operation: "note",
      idempotencyKey: "run_steve:note:1",
      outcome: "completed",
      externalId: "note_1",
      httpStatus: 201,
    }),
    "skip_completed"
  );
});

test("the agent note formatter does not call the network", () => {
  const source = readFileSync(new URL("./ghl-agent-lead-note.ts", import.meta.url), "utf8");
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("ghlLiveJson"), false);
});
