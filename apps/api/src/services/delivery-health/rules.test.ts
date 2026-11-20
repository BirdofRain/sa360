import assert from "node:assert/strict";
import test from "node:test";

import {
  DELIVERY_HEALTH_DISPATCH_WARNING_MS,
  DELIVERY_HEALTH_ESCALATION_MS,
  DELIVERY_HEALTH_RECEIPT_WARNING_MS,
  evaluateDeliveryHealth,
  type DeliveryHealthClient,
  type DeliveryHealthIntakeCandidate,
  type DeliveryHealthIntent,
  type DeliveryHealthJob,
  type DeliveryHealthLead,
  type DeliveryHealthSnapshot,
} from "./rules.js";

const CLIENT = "client_pilot";
const NOW = new Date("2026-11-20T18:00:00.000Z");
const CUTOFF = new Date("2026-11-01T00:00:00.000Z");

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

function armedClient(overrides: Partial<DeliveryHealthClient> = {}): DeliveryHealthClient {
  return {
    clientAccountId: CLIENT,
    status: "active",
    destination: { campaignDispatchEnabled: true, campaignDispatchNotBefore: CUTOFF },
    ...overrides,
  };
}

function lead(minutes: number, overrides: Partial<DeliveryHealthLead> = {}): DeliveryHealthLead {
  const at = minutesAgo(minutes);
  return {
    id: "lead_1",
    clientAccountId: CLIENT,
    status: "routing_matched",
    routedAt: at,
    receivedAt: at,
    sourceRouteKey: "go.example.test/ray",
    cleanupStatus: null,
    ...overrides,
  };
}

function intent(overrides: Partial<DeliveryHealthIntent> = {}): DeliveryHealthIntent {
  return {
    id: "intent_1",
    clientAccountId: CLIENT,
    sourceLeadEventId: "lead_1",
    kind: "campaign_lead",
    status: "completed",
    reason: null,
    lastError: null,
    jobId: "job_1",
    createdAt: CUTOFF,
    ...overrides,
  };
}

function job(overrides: Partial<DeliveryHealthJob> = {}): DeliveryHealthJob {
  return {
    id: "job_1",
    kind: "lead",
    status: "succeeded",
    clientAccountId: CLIENT,
    sourceLeadEventId: "lead_1",
    idempotencyKey: `lead:${CLIENT}:lead_1`,
    rowsWritten: 1,
    appendStartedAt: null,
    finishedAt: minutesAgo(1),
    lastError: null,
    uncertainReason: null,
    createdAt: minutesAgo(4),
    ...overrides,
  };
}

function snapshot(overrides: Partial<DeliveryHealthSnapshot> = {}): DeliveryHealthSnapshot {
  return {
    clients: [armedClient()],
    leads: [],
    intents: [],
    jobs: [],
    rows: [],
    onboardingTestAttemptKeys: [],
    intake: [],
    ...overrides,
  };
}

function classes(value: DeliveryHealthSnapshot): string[] {
  return evaluateDeliveryHealth(value, NOW).map((finding) => `${finding.failureClass}:${finding.severity}:${finding.affectedCount}`);
}

test("dispatch, receipt, and escalation windows are the phase 1 minutes", () => {
  assert.equal(DELIVERY_HEALTH_DISPATCH_WARNING_MS, 2 * 60 * 1000);
  assert.equal(DELIVERY_HEALTH_RECEIPT_WARNING_MS, 5 * 60 * 1000);
  assert.equal(DELIVERY_HEALTH_ESCALATION_MS, 15 * 60 * 1000);
});

test("a completed lead job with written rows is a receipt", () => {
  const found = evaluateDeliveryHealth(
    snapshot({
      leads: [lead(10)],
      intents: [intent()],
      jobs: [job()],
      rows: [{ jobId: "job_1", status: "written" }],
    }),
    NOW
  );
  assert.deepEqual(found, []);
});

test("succeeded status without written rows is unverified", () => {
  const found = evaluateDeliveryHealth(
    snapshot({
      leads: [lead(1)],
      intents: [intent()],
      jobs: [job({ rowsWritten: 0, finishedAt: minutesAgo(1) })],
      rows: [{ jobId: "job_1", status: "pending" }],
    }),
    NOW
  );
  assert.deepEqual(classes(snapshot({
    leads: [lead(1)],
    intents: [intent()],
    jobs: [job({ rowsWritten: 0 })],
    rows: [{ jobId: "job_1", status: "pending" }],
  })), ["sheets_receipt_unverified:critical:1"]);
  assert.equal(found[0]?.failureClass, "sheets_receipt_unverified");
  assert.equal(JSON.stringify(found).includes("200"), false);
});

test("a retryable network delay warns at 5 minutes and escalates at 15", () => {
  const base = {
    leads: [lead(6)],
    intents: [intent({ status: "retryable", lastError: "network_error", jobId: "job_1" })],
    jobs: [job({ status: "retryable", lastError: "network_error", rowsWritten: 0, finishedAt: null })],
    rows: [{ jobId: "job_1", status: "pending" }],
  };
  assert.deepEqual(classes(snapshot(base)), ["sheets_receipt_delayed:warning:1"]);
  assert.deepEqual(
    classes(snapshot({ ...base, leads: [lead(4)] })),
    []
  );
  assert.deepEqual(
    classes(snapshot({ ...base, leads: [lead(16)] })),
    ["sheets_receipt_delayed:critical:1"]
  );
});

test("an uncertain append is critical immediately", () => {
  const found = evaluateDeliveryHealth(
    snapshot({
      leads: [lead(0.2)],
      intents: [intent({ status: "scheduled", lastError: "uncertain", reason: "append_outcome_unresolved" })],
      jobs: [
        job({
          status: "uncertain",
          uncertainReason: "append_outcome_unknown",
          appendStartedAt: minutesAgo(0.1),
          finishedAt: null,
          rowsWritten: 0,
        }),
      ],
      rows: [{ jobId: "job_1", status: "pending" }],
    }),
    NOW
  );
  assert.equal(found[0]?.failureClass, "uncertain_append");
  assert.equal(found[0]?.severity, "critical");
  assert.equal(found[0]?.subjects[0]?.code, "append_outcome_unknown");
});

test("a later canonical receipt clears an older failed or uncertain job", () => {
  const rows = [
    { jobId: "job_old", status: "pending" },
    { jobId: "job_new", status: "written" },
  ];
  const reconciled = intent({ status: "completed", jobId: "job_new", lastError: "access_denied" });
  const olderUncertain = job({
    id: "job_old",
    status: "uncertain",
    uncertainReason: "append_outcome_unknown",
    appendStartedAt: minutesAgo(10),
    finishedAt: null,
    rowsWritten: 0,
    createdAt: minutesAgo(10),
  });
  const newerReceipt = job({ id: "job_new", createdAt: minutesAgo(2) });
  assert.deepEqual(
    classes(snapshot({
      leads: [lead(12)],
      intents: [reconciled],
      jobs: [olderUncertain, newerReceipt],
      rows,
    })),
    []
  );
  const olderDenied = job({
    id: "job_old",
    status: "retryable",
    lastError: "access_denied",
    rowsWritten: 0,
    finishedAt: null,
    createdAt: minutesAgo(10),
  });
  assert.deepEqual(
    classes(snapshot({
      leads: [lead(12)],
      intents: [reconciled],
      jobs: [olderDenied, newerReceipt],
      rows,
    })),
    []
  );
  const olderUnverified = job({
    id: "job_old",
    status: "succeeded",
    rowsWritten: 0,
    finishedAt: minutesAgo(9),
    createdAt: minutesAgo(10),
  });
  assert.deepEqual(
    classes(snapshot({
      leads: [lead(12)],
      intents: [reconciled],
      jobs: [olderUnverified, newerReceipt],
      rows: [
        { jobId: "job_old", status: "pending" },
        { jobId: "job_new", status: "written" },
      ],
    })),
    []
  );
  const newerUncertain = job({
    id: "job_new",
    status: "uncertain",
    uncertainReason: "append_outcome_unknown",
    appendStartedAt: minutesAgo(1),
    finishedAt: null,
    rowsWritten: 0,
    createdAt: minutesAgo(1),
  });
  const olderReceipt = job({ id: "job_old", createdAt: minutesAgo(8) });
  const stillOpen = evaluateDeliveryHealth(
    snapshot({
      leads: [lead(12)],
      intents: [intent({ status: "scheduled", jobId: "job_new" })],
      jobs: [olderReceipt, newerUncertain],
      rows: [
        { jobId: "job_old", status: "written" },
        { jobId: "job_new", status: "pending" },
      ],
    }),
    NOW
  );
  assert.equal(stillOpen[0]?.failureClass, "uncertain_append");
  assert.equal(stillOpen[0]?.severity, "critical");
  assert.equal(stillOpen[0]?.subjects[0]?.jobId, "job_new");
});

test("a permissions error is critical immediately", () => {
  const found = evaluateDeliveryHealth(
    snapshot({
      leads: [lead(0.2)],
      intents: [intent({ status: "retryable", lastError: "access_denied" })],
      jobs: [job({ status: "retryable", lastError: "access_denied", rowsWritten: 0, finishedAt: null })],
      rows: [{ jobId: "job_1", status: "pending" }],
    }),
    NOW
  );
  assert.equal(found[0]?.failureClass, "google_permission");
  assert.equal(found[0]?.severity, "critical");
});

test("a terminal Google authorization failure is critical immediately", () => {
  const found = evaluateDeliveryHealth(
    snapshot({
      leads: [lead(1)],
      intents: [intent({ status: "retryable", lastError: "google_reconnect_required" })],
      jobs: [job({ status: "retryable", lastError: "google_reconnect_required", rowsWritten: 0, finishedAt: null })],
    }),
    NOW
  );
  assert.equal(found[0]?.failureClass, "google_authorization");
});

test("a configuration failure outside an expected hold is critical", () => {
  const found = evaluateDeliveryHealth(
    snapshot({
      leads: [lead(1)],
      intents: [intent({ status: "retryable", lastError: "worksheet_unavailable" })],
      jobs: [job({ status: "retryable", lastError: "worksheet_unavailable", rowsWritten: 0, finishedAt: null })],
    }),
    NOW
  );
  assert.equal(found[0]?.failureClass, "google_configuration");
});

test("missing dispatch warns at 2 minutes and escalates at 15", () => {
  assert.deepEqual(classes(snapshot({ leads: [lead(1)] })), []);
  assert.deepEqual(classes(snapshot({ leads: [lead(3)] })), ["missing_dispatch:warning:1"]);
  assert.deepEqual(classes(snapshot({ leads: [lead(16)] })), ["missing_dispatch:critical:1"]);
});

test("an intended duplicate hold is silent", () => {
  assert.deepEqual(
    classes(
      snapshot({
        leads: [lead(20)],
        intents: [intent({ status: "duplicate_held", lastError: "person_duplicate", jobId: null })],
      })
    ),
    []
  );
});

test("expected setup holds and test jobs are silent", () => {
  assert.deepEqual(
    classes(
      snapshot({
        leads: [lead(20)],
        intents: [intent({ status: "awaiting_setup", reason: "tab_missing", jobId: null })],
        jobs: [job({ status: "retryable", lastError: "tab_missing", rowsWritten: 0, finishedAt: null })],
      })
    ),
    []
  );
  assert.deepEqual(
    classes(
      snapshot({
        leads: [lead(20)],
        intents: [intent({ jobId: "job_test" })],
        jobs: [job({ id: "job_test", kind: "campaign_test", status: "uncertain", uncertainReason: "append_outcome_unknown" })],
      })
    ),
    []
  );
});

test("a paused client and a disabled destination do not page for missing dispatch", () => {
  assert.deepEqual(
    classes(snapshot({ clients: [armedClient({ status: "paused" })], leads: [lead(20)] })),
    []
  );
  assert.deepEqual(
    classes(
      snapshot({
        clients: [armedClient({ destination: { campaignDispatchEnabled: false, campaignDispatchNotBefore: CUTOFF } })],
        leads: [lead(20)],
      })
    ),
    []
  );
});

test("a quiet pilot with no leads and no corroborated intake is not an incident", () => {
  assert.deepEqual(classes(snapshot()), []);
});

test("webhook HTTP 200 without a routing decision is not missing intake and is not a Sheets receipt", () => {
  const delayed = classes(
    snapshot({
      leads: [lead(6)],
      intents: [intent({ status: "pending", jobId: "job_1" })],
      jobs: [job({ status: "queued", rowsWritten: 0, finishedAt: null, lastError: null })],
      rows: [{ jobId: "job_1", status: "pending" }],
    })
  );
  assert.deepEqual(delayed, ["sheets_receipt_delayed:warning:1"]);
});

test("missing intake requires the routing decision and the webhook audit together", () => {
  const candidate: DeliveryHealthIntakeCandidate = {
    clientAccountId: CLIENT,
    routingDryRunDecisionId: "decision_1",
    webhookRequestLogId: "webhook_1",
    processingStatus: "stored",
    httpStatus: 200,
    completedAt: minutesAgo(3),
    sourceEventExists: false,
    syntheticPilot: false,
    matched: true,
  };
  assert.deepEqual(classes(snapshot({ intake: [candidate] })), ["missing_intake:warning:1"]);
  assert.deepEqual(classes(snapshot({ intake: [{ ...candidate, sourceEventExists: true }] })), []);
  assert.deepEqual(classes(snapshot({ intake: [{ ...candidate, matched: false }] })), []);
  assert.deepEqual(classes(snapshot({ intake: [{ ...candidate, processingStatus: "validation_failed" }] })), []);
  assert.deepEqual(classes(snapshot({ intake: [{ ...candidate, httpStatus: 500 }] })), []);
  assert.deepEqual(classes(snapshot({ intake: [{ ...candidate, completedAt: minutesAgo(1) }] })), []);
  assert.deepEqual(
    classes(snapshot({ clients: [armedClient({ status: "paused" })], intake: [candidate] })),
    []
  );
  assert.deepEqual(
    classes(snapshot({ intake: [{ ...candidate, completedAt: minutesAgo(16) }] })),
    ["missing_intake:critical:1"]
  );
});

test("lead contact fields on the snapshot do not enter findings", () => {
  const found = evaluateDeliveryHealth(
    snapshot({
      leads: [
        lead(3, {
          enrichmentMetadataJson: { email: "lead@example.com", phone: "555-010-0199", recordClass: "ordinary" },
        }),
      ],
    }),
    NOW
  );
  const encoded = JSON.stringify(found);
  assert.equal(encoded.includes("lead@example.com"), false);
  assert.equal(encoded.includes("555-010-0199"), false);
  assert.equal(found[0]?.failureClass, "missing_dispatch");
});

test("an internal Sheets pilot lead is outside the client pilot", () => {
  assert.deepEqual(
    classes(
      snapshot({
        leads: [lead(20, { sourceRouteKey: "company_sheets_internal_pilot" })],
      })
    ),
    []
  );
});
