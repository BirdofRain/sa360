import test from "node:test";
import assert from "node:assert/strict";

import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import { approveLf2DuplicateVerificationForSourceLead } from "./lf2-verification-approval.service.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { findSourceLeadEventById } from "../../repositories/source-lead-event.repository.js";

const baseEvent = {
  id: "evt_approve",
  sourceLeadUid: "lead_approve_1",
  clientAccountIdResolved: "smart_agent_360_demo_2",
  destinationLocationIdResolved: "VPuMIhN6JpxdoXvvlekZ",
  deliveredAt: null,
  deliveryResultJson: null,
  routingDryRunDecisionId: null,
  normalizedPayloadJson: {
    contact: {
      phone_e164: "+15551234567",
      email: "lead@example.com",
      state: "Texas",
    },
  },
};

const clientWithDestination = {
  clientAccountId: "smart_agent_360_demo_2",
  ghlDestination: { destinationSubaccountIdGhl: "VPuMIhN6JpxdoXvvlekZ" },
};

const eligiblePreview = {
  sourceLeadEventId: "evt_approve",
  maskedSourceLeadUid: "lead***_1",
  resolvedSourceLane: "facebook_meta_lead_ads",
  resolvedProofPolicy: "meta_lead_ads",
  proofStatus: null,
  phonePresent: true,
  emailPresent: true,
  statePresent: true,
  state: "Texas",
  maskedPhone: "(555) ***-4567",
  maskedEmail: "l***@example.com",
  consentPresent: false,
  duplicateStatus: "UNIQUE",
  verificationStatus: "PASSED",
  verificationPresent: true,
  predictedEligibilityStatus: "eligible" as const,
  predictedReasonCodes: [] as string[],
  policyKey: "lf2_shadow_eligibility",
  policyVersion: "1.0.0",
  summaries: {
    proofBlocksEligibility: false,
    proofRequiresReview: false,
    duplicateBlocked: false,
    duplicateRequiresReview: false,
    duplicateUnchecked: false,
    consentReviewRequired: false,
    requiredFieldsComplete: true,
  },
};

function makeDb(overrides: Record<string, unknown> = {}) {
  const writes: string[] = [];
  const verificationStore: Record<string, unknown> = {};
  const auditEvents: unknown[] = [];

  const db = {
    leadVerificationResult: {
      findUnique: async ({ where }: { where: { leadUid: string } }) =>
        verificationStore[where.leadUid] ?? null,
      upsert: async ({ where, create, update }: { where: { leadUid: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = verificationStore[where.leadUid];
        const next = existing ? { ...existing, ...update } : create;
        verificationStore[where.leadUid] = next;
        writes.push("verification");
        return {
          id: "ver_1",
          leadUid: where.leadUid,
          verificationStatus: next.verificationStatus,
          duplicateStatus: next.duplicateStatus,
          phoneStatus: next.phoneStatus,
          emailStatus: next.emailStatus,
          checkedAt: next.checkedAt ?? null,
        };
      },
    },
    leadAllocation: { count: async () => 0 },
    deliveryAttempt: { count: async () => 0 },
    ghlLiveDeliveryRun: { count: async () => 0 },
    leadVerificationApprovalAuditEvent: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditEvents.push(data);
        writes.push("audit");
        return { id: "audit_1", ...data };
      },
    },
    $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
    ...overrides,
  };

  return { db: db as never, writes, verificationStore, auditEvents };
}

test("fingerprintIdentityValue normalizes email case", () => {
  const a = fingerprintIdentityValue("email", "Lead@Example.COM");
  const b = fingerprintIdentityValue("email", "lead@example.com");
  assert.equal(a, b);
});

test("approveLf2DuplicateVerification persists UNIQUE and returns eligible preview", async () => {
  const { db, writes, verificationStore } = makeDb();

  const result = await approveLf2DuplicateVerificationForSourceLead(
    {
      sourceLeadEventId: "evt_approve",
      requestedBy: "operator@test",
      operatorNote: "approved after search",
    },
    db,
    {
      findSourceLeadEventById: (async () => baseEvent) as unknown as typeof findSourceLeadEventById,
      findClientAccountById: (async () => clientWithDestination) as unknown as typeof findClientAccountById,
      runGhlDuplicateSearch: async () => ({
        ok: true,
        summary: {
          sourceLeadEventId: "evt_approve",
          clientAccountId: "smart_agent_360_demo_2",
          destinationSubaccountIdGhl: "VPuMIhN6JpxdoXvvlekZ",
          classification: "no_duplicate_found",
          phonePresent: true,
          emailPresent: true,
          phoneSearchAttempted: true,
          emailSearchAttempted: true,
          phoneSearchOutcome: "not_found",
          emailSearchOutcome: "not_found",
          matchedContactIdGhl: null,
          reasonCode: "authoritative_search_not_found",
        },
      }),
      buildEligibilityPreview: async () => ({ ok: true, preview: eligiblePreview }),
    }
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.approvalStatus, "applied");
    assert.equal(result.newDuplicateStatus, "UNIQUE");
    assert.equal(result.action, "APPROVE_UNIQUE");
    assert.equal(result.postApprovalEligibilityPreview.predictedEligibilityStatus, "eligible");
    assert.equal(result.duplicateSearchClassification, "no_duplicate_found");
    assert.equal(result.maskedSourceLeadUid?.includes("***"), true);
  }
  assert.ok(writes.includes("audit"));
  assert.ok(writes.includes("verification"));
});

test("approveLf2DuplicateVerification rejects when duplicate search is not clear", async () => {
  const { db } = makeDb();
  const result = await approveLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: "evt_approve" },
    db,
    {
      findSourceLeadEventById: (async () => baseEvent) as unknown as typeof findSourceLeadEventById,
      findClientAccountById: (async () => clientWithDestination) as unknown as typeof findClientAccountById,
      runGhlDuplicateSearch: async () => ({
        ok: true,
        summary: {
          sourceLeadEventId: "evt_approve",
          clientAccountId: "smart_agent_360_demo_2",
          destinationSubaccountIdGhl: "VPuMIhN6JpxdoXvvlekZ",
          classification: "duplicate_risk",
          phonePresent: true,
          emailPresent: true,
          phoneSearchAttempted: true,
          emailSearchAttempted: true,
          phoneSearchOutcome: "matched",
          emailSearchOutcome: "not_found",
          matchedContactIdGhl: null,
          reasonCode: "partial_identity_match",
        },
      }),
    }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "duplicate_search_not_clear");
    assert.ok(result.auditEventId);
    assert.equal(result.duplicateSearchClassification, "duplicate_risk");
  }
});

test("approveLf2DuplicateVerification rejects blocked existing verification", async () => {
  const { db, verificationStore } = makeDb();
  verificationStore["lead_approve_1"] = {
    verificationStatus: "FAILED",
    duplicateStatus: "DUPLICATE_GLOBAL",
  };

  const result = await approveLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: "evt_approve" },
    db,
    {
      findSourceLeadEventById: (async () => baseEvent) as unknown as typeof findSourceLeadEventById,
      findClientAccountById: (async () => clientWithDestination) as unknown as typeof findClientAccountById,
    }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "verification_blocked");
  }
});

test("approveLf2DuplicateVerification rejects prior delivery evidence", async () => {
  const { db } = makeDb();
  const result = await approveLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: "evt_approve" },
    db,
    {
      findSourceLeadEventById: (async () => ({
        ...baseEvent,
        deliveredAt: new Date("2026-07-01T00:00:00.000Z"),
      })) as unknown as typeof findSourceLeadEventById,
      findClientAccountById: (async () => clientWithDestination) as unknown as typeof findClientAccountById,
    }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "prior_delivery_evidence");
  }
});

test("approveLf2DuplicateVerification requires both phone and email", async () => {
  const { db } = makeDb();
  const result = await approveLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: "evt_approve" },
    db,
    {
      findSourceLeadEventById: (async () => ({
        ...baseEvent,
        normalizedPayloadJson: { contact: { phone_e164: "+15551234567", state: "Texas" } },
      })) as unknown as typeof findSourceLeadEventById,
      findClientAccountById: (async () => clientWithDestination) as unknown as typeof findClientAccountById,
    }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "identity_incomplete");
  }
});
