import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { canonicalGhlDelivery, ghlContactReceived, type GhlCanonicalStep } from "../delivery-success/canonical-delivery.js";
import { EXTERNAL_WEBHOOK_SMS_TEMPLATES } from "../external-webhook-notification/notification-contract.js";
import { composeGhlLeadSmsConsentText, composeSmsConsentText } from "../external-webhook-notification/sms-disclosure.js";
import { smsConsentAllowsGhlLeadNotice, smsConsentAllowsNotice } from "../external-webhook-notification/sms-consent.js";
import { GHL_LEAD_RECEIVED_SMS_BODY, planGhlLeadSms, type GhlLeadSmsPlan } from "./contract.js";

const CLIENT = "clientA";
const EVENT = "evtCampaign1";
const LOCATION = "locAlpha1";
const RUN = "run1";
const CONTACT = "contact1";
const COMPLETED = new Date("2026-11-17T18:00:00.000Z");
const CONSENT_AT = new Date("2026-11-16T18:00:00.000Z");
const PRIVACY = "https://policies.lifeagentlaunch.invalid/privacy";
const TERMS = "https://policies.lifeagentlaunch.invalid/terms";

function receipt(operation: string, outcome: string, externalId: string | null) {
  return {
    externalCallExecuted: true,
    vetOperationReceipt: {
      operation,
      outcome,
      externalId,
      httpStatus: outcome === "completed" ? 200 : 500,
      idempotencyKey: `assoc_${operation}`,
    },
  };
}

function contactStep(outcome = "completed", externalId: string | null = CONTACT): GhlCanonicalStep {
  return {
    stepType: "create_or_update_contact",
    status: outcome === "completed" ? "succeeded" : "failed",
    externalId,
    responseRedactedJson: receipt("contact", outcome, externalId),
  };
}

function receivedInput(overrides?: {
  mode?: string;
  status?: string;
  completedAt?: Date | null;
  steps?: GhlCanonicalStep[];
  sourceType?: string;
  bulkImportId?: string | null;
  outboxStatus?: string;
  clientAccountId?: string;
  locationIdGhl?: string;
  onboardingKeys?: string[] | null;
}) {
  const clientAccountId = overrides?.clientAccountId ?? CLIENT;
  const locationIdGhl = overrides?.locationIdGhl ?? LOCATION;
  return {
    run: {
      id: RUN,
      mode: overrides?.mode ?? "ongoing_association",
      status: overrides?.status ?? "succeeded",
      completedAt: overrides && "completedAt" in overrides ? overrides.completedAt ?? null : COMPLETED,
      destinationClientAccountId: CLIENT,
      destinationSubaccountIdGhl: LOCATION,
      idempotencyKey: "ghl_association_evtCampaign1",
    },
    steps: overrides?.steps ?? [contactStep()],
    destination: { clientAccountId, locationIdGhl },
    outbox: {
      status: overrides?.outboxStatus ?? "settled",
      clientAccountId: CLIENT,
      sourceLeadEventId: EVENT,
      destinationLocationIdGhl: LOCATION,
      liveRunId: RUN,
    },
    sourceLead: {
      id: EVENT,
      bulkImportId: overrides?.bulkImportId ?? null,
      bulkImportRowId: null,
      sourceType: overrides?.sourceType ?? "webhook",
    },
    onboardingTestAttemptKeys: overrides && "onboardingKeys" in overrides ? overrides.onboardingKeys ?? null : [],
  };
}

function preference(version: "ghl" | "v2" | "stop") {
  const text =
    version === "v2"
      ? composeSmsConsentText({ privacyPolicyUrl: PRIVACY, termsUrl: TERMS })
      : composeGhlLeadSmsConsentText({ privacyPolicyUrl: PRIVACY, termsUrl: TERMS });
  return {
    smsEnabled: version !== "stop",
    smsSuppressionState: version === "stop" ? "suppressed" : "clear",
    smsConsentVersion: version === "v2" ? "external-webhook-sms-v2" : "ghl-lead-sms-v1",
    smsConsentText: text,
    smsConsentRecordedAt: CONSENT_AT,
    smsEnabledAt: CONSENT_AT,
    smsHandsetProvenAt: null,
    recipientPhoneE164: "+15555550123",
  };
}

function recordPlan(): Extract<GhlLeadSmsPlan, { action: "record" }> {
  const plan = planGhlLeadSms({
    evidence: "ghl_contact",
    clientAccountId: CLIENT,
    contact: ghlContactReceived(receivedInput()),
    liveRunId: RUN,
    preference: preference("ghl"),
  });
  assert.equal(plan.action, "record");
  if (plan.action !== "record") throw new Error("expected record");
  return plan;
}

test("a proven contact write is received even when workflow enrollment fails", () => {
  const steps: GhlCanonicalStep[] = [
    contactStep(),
    {
      stepType: "add_tags",
      status: "succeeded",
      externalId: null,
      responseRedactedJson: receipt("tags", "completed", null),
    },
    {
      stepType: "start_workflow",
      status: "failed",
      externalId: null,
      responseRedactedJson: receipt("workflow", "ambiguous", null),
    },
  ];
  const contact = ghlContactReceived(receivedInput({ status: "failed", steps, outboxStatus: "uncertain" }));
  assert.equal(contact.received, true);
  assert.equal(contact.contactId, CONTACT);
  assert.equal(contact.sourceLeadEventId, EVENT);
  const canonical = canonicalGhlDelivery({
    run: {
      id: RUN,
      mode: "ongoing_association",
      status: "failed",
      completedAt: COMPLETED,
      destinationClientAccountId: CLIENT,
      idempotencyKey: "ghl_association_evtCampaign1",
    },
    steps,
    destination: { clientAccountId: CLIENT, workflowStartRequired: true },
    opportunityConfigured: false,
    intakeSummaryNotesEnabled: false,
    onboardingProfileNotesEnabled: false,
    profile: { clientAccountId: CLIENT, notesEnabled: false },
    outbox: {
      status: "uncertain",
      clientAccountId: CLIENT,
      sourceLeadEventId: EVENT,
      externalCallExecuted: true,
      lastError: "workflow",
      liveRunId: RUN,
    },
    onboardingTestAttemptId: null,
    onboardingTestAttemptKeys: [],
  });
  assert.equal(canonical.canonical, false);
  assert.equal(canonical.reasons.includes("workflow_not_enrolled"), true);
});

test("HTTP success without a contact receipt is not a received contact", () => {
  const httpOnly = ghlContactReceived(
    receivedInput({
      steps: [
        {
          stepType: "create_or_update_contact",
          status: "succeeded",
          externalId: CONTACT,
          responseRedactedJson: { httpStatus: 200, externalCallExecuted: true },
        },
      ],
    })
  );
  assert.equal(httpOnly.received, false);
  assert.equal(httpOnly.reasons.includes("contact_not_proven") || httpOnly.reasons.includes("contact_not_upserted"), true);
  const missingId = ghlContactReceived(receivedInput({ steps: [contactStep("completed", null)] }));
  assert.equal(missingId.received, false);
  assert.equal(missingId.reasons.includes("contact_external_id_missing"), true);
});

test("simulations, open runs, backfills, and the wrong location are not received", () => {
  for (const mode of ["live_canary", "paused_location_test", "location_api", "simulate"]) {
    const verdict = ghlContactReceived(receivedInput({ mode }));
    assert.equal(verdict.received, false, mode);
  }
  assert.equal(ghlContactReceived(receivedInput({ status: "executing" })).received, false);
  assert.equal(ghlContactReceived(receivedInput({ status: "skipped_duplicate" })).received, false);
  assert.equal(ghlContactReceived(receivedInput({ bulkImportId: "import1" })).reasons.includes("historical_backfill"), true);
  assert.equal(ghlContactReceived(receivedInput({ sourceType: "bulk_import" })).received, false);
  assert.equal(ghlContactReceived(receivedInput({ locationIdGhl: "otherLoc" })).received, false);
  assert.equal(ghlContactReceived(receivedInput({ clientAccountId: "otherClient" })).received, false);
  const synthetic = receivedInput();
  synthetic.outbox.sourceLeadEventId = "synthetic-campaign-test";
  synthetic.sourceLead.id = "synthetic-campaign-test";
  assert.equal(ghlContactReceived(synthetic).reasons.includes("synthetic_campaign_test"), true);
});

test("the GHL SMS body is fixed and does not reuse the webhook template", () => {
  const plan = recordPlan();
  assert.equal(plan.body, GHL_LEAD_RECEIVED_SMS_BODY);
  assert.equal(plan.body.includes("@"), false);
  assert.equal(plan.body.includes(CONTACT), false);
  assert.equal(plan.body.includes("+1555"), false);
  assert.equal(
    EXTERNAL_WEBHOOK_SMS_TEMPLATES.delivery_accepted,
    "Life Agent Launch: a delivery webhook was accepted. Reply STOP to opt out. Reply HELP for help. Msg & data rates may apply."
  );
  const ghlBody: string = plan.body;
  const webhookBody: string = EXTERNAL_WEBHOOK_SMS_TEMPLATES.delivery_accepted;
  assert.equal(ghlBody === webhookBody, false);
  const again = recordPlan();
  assert.equal(again.idempotencyKey, plan.idempotencyKey);
  assert.equal(again.idempotencyKey, `ghl_lead_received:${CLIENT}:${EVENT}:${LOCATION}`);
});

function skipReason(plan: GhlLeadSmsPlan): string {
  assert.equal(plan.action, "skip");
  if (plan.action !== "skip") throw new Error("expected skip");
  return plan.reason;
}

test("Sheets, webhook acceptance, v2 consent, and STOP do not plan a GHL SMS", () => {
  const contact = ghlContactReceived(receivedInput());
  assert.equal(
    skipReason(planGhlLeadSms({ evidence: "company_sheets", clientAccountId: CLIENT, contact, liveRunId: RUN, preference: preference("ghl") })),
    "sheets_only"
  );
  assert.equal(
    skipReason(
      planGhlLeadSms({ evidence: "external_webhook", clientAccountId: CLIENT, contact, liveRunId: RUN, preference: preference("ghl") })
    ),
    "external_webhook_only"
  );
  const v2 = preference("v2");
  assert.equal(smsConsentAllowsNotice(v2), true);
  assert.equal(smsConsentAllowsGhlLeadNotice(v2), false);
  assert.equal(
    skipReason(planGhlLeadSms({ evidence: "ghl_contact", clientAccountId: CLIENT, contact, liveRunId: RUN, preference: v2 })),
    "not_opted_in"
  );
  assert.equal(
    skipReason(
      planGhlLeadSms({ evidence: "ghl_contact", clientAccountId: CLIENT, contact, liveRunId: RUN, preference: preference("stop") })
    ),
    "stop_suppressed"
  );
  assert.equal(
    skipReason(
      planGhlLeadSms({
        evidence: "ghl_contact",
        clientAccountId: CLIENT,
        contact: ghlContactReceived(receivedInput({ completedAt: new Date(CONSENT_AT.getTime() - 1000) })),
        liveRunId: RUN,
        preference: preference("ghl"),
      })
    ),
    "before_consent"
  );
});

test("association settlement and webhook intake do not send this SMS", () => {
  const files = [
    new URL("../ghl-association-dispatch/ghl-association-dispatch.ts", import.meta.url),
    new URL("../association-ongoing-delivery.ts", import.meta.url),
    new URL("../../routes/webhook.ts", import.meta.url),
    new URL("../../routes/webhook-leadcaptureio.ts", import.meta.url),
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("dispatchGhlLeadNotice"), false, String(file));
    assert.equal(source.includes("discoverGhlLeadNotices"), false, String(file));
  }
});
