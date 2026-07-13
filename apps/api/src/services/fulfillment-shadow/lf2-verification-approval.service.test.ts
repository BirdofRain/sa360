import test from "node:test";
import assert from "node:assert/strict";

import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import { evaluateLeadEligibility } from "./eligibility.service.js";
import {
  approveLf2DuplicateVerificationForSourceLead,
  revokeLf2DuplicateVerificationForSourceLead,
} from "./lf2-verification-approval.service.js";
import { buildEligibilityPreviewForSourceLead } from "./eligibility-preview.service.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { findSourceLeadEventById } from "../../repositories/source-lead-event.repository.js";

export const CANDIDATE_EVENT_ID = "cmqsqy81z001nml0vsojfhshc";
export const CANDIDATE_CLIENT = "smart_agent_360_demo_2";
export const CANDIDATE_DESTINATION = "VPuMIhN6JpxdoXvvlekZ";

const baseEvent = {
  id: CANDIDATE_EVENT_ID,
  sourceLeadUid: "facebook_meta_lead_ads_candidate_uid_1110",
  clientAccountIdResolved: CANDIDATE_CLIENT,
  destinationLocationIdResolved: CANDIDATE_DESTINATION,
  deliveredAt: null,
  deliveryResultJson: null,
  routingDryRunDecisionId: null,
  sourceProvider: "facebook",
  sourceSystem: "meta_lead_ads",
  normalizedPayloadJson: {
    contact: {
      phone_e164: "+14155550100",
      email: "jane.doe@example.test",
      state: "Texas",
    },
  },
  enrichmentMetadataJson: null,
};

const clientWithDestination = {
  clientAccountId: CANDIDATE_CLIENT,
  ghlDestination: { destinationSubaccountIdGhl: CANDIDATE_DESTINATION },
};

const noDuplicateSummary = {
  sourceLeadEventId: CANDIDATE_EVENT_ID,
  clientAccountId: CANDIDATE_CLIENT,
  destinationSubaccountIdGhl: CANDIDATE_DESTINATION,
  classification: "no_duplicate_found" as const,
  phonePresent: true,
  emailPresent: true,
  phoneSearchAttempted: true,
  emailSearchAttempted: true,
  phoneSearchOutcome: "not_found" as const,
  emailSearchOutcome: "not_found" as const,
  matchedContactIdGhl: null,
  reasonCode: "authoritative_search_not_found",
};

const eligiblePreview = {
  sourceLeadEventId: CANDIDATE_EVENT_ID,
  maskedSourceLeadUid: "face***1110",
  resolvedSourceLane: "facebook_meta_lead_ads",
  resolvedProofPolicy: "meta_lead_ads",
  proofStatus: null,
  phonePresent: true,
  emailPresent: true,
  statePresent: true,
  state: "Texas",
  maskedPhone: "(141) ***-0100",
  maskedEmail: "j***@example.test",
  consentPresent: false,
  duplicateStatus: "UNIQUE" as const,
  verificationStatus: "PASSED" as const,
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

function authDeps(runGhlDuplicateSearch: Lf2VerificationApprovalDeps["runGhlDuplicateSearch"]) {
  return {
    findSourceLeadEventById: (async () => baseEvent) as unknown as typeof findSourceLeadEventById,
    findClientAccountById: (async () => clientWithDestination) as unknown as typeof findClientAccountById,
    runGhlDuplicateSearch,
    buildEligibilityPreview: async () => ({ ok: true as const, preview: eligiblePreview }),
  };
}

type Lf2VerificationApprovalDeps = NonNullable<
  Parameters<typeof approveLf2DuplicateVerificationForSourceLead>[2]
>;

function makeDb(overrides: Record<string, unknown> = {}) {
  const writes: string[] = [];
  const lf2Writes: string[] = [];
  const verificationStore: Record<string, unknown> = {};
  const auditEvents: Record<string, unknown>[] = [];

  const trackLf2 = (table: string) => ({
    count: async () => 0,
    create: async () => {
      lf2Writes.push(table);
      writes.push(table);
      return { id: `${table}_1` };
    },
    upsert: async () => {
      lf2Writes.push(table);
      writes.push(table);
      return { id: `${table}_1` };
    },
  });

  type TestDb = {
    leadVerificationResult: {
      findUnique: (args: { where: { leadUid: string } }) => Promise<Record<string, unknown> | null>;
      upsert: (args: {
        where: { leadUid: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => Promise<Record<string, unknown>>;
      update: (args: { where: { leadUid: string }; data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
    };
    leadAllocation: ReturnType<typeof trackLf2>;
    deliveryAttempt: ReturnType<typeof trackLf2>;
    ghlLiveDeliveryRun: { count: () => Promise<number> };
    leadEligibilityAssessment: ReturnType<typeof trackLf2>;
    fulfillmentOutbox: ReturnType<typeof trackLf2>;
    deliveryInstruction: ReturnType<typeof trackLf2>;
    leadOrder: ReturnType<typeof trackLf2>;
    deliveryTarget: ReturnType<typeof trackLf2>;
    leadVerificationApprovalAuditEvent: {
      findFirst: () => Promise<null>;
      create: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
    };
    $transaction: <T>(fn: (tx: TestDb) => Promise<T>) => Promise<T>;
  };

  const db: TestDb = {
    leadVerificationResult: {
      findUnique: async ({ where }: { where: { leadUid: string } }) =>
        (verificationStore[where.leadUid] as Record<string, unknown> | undefined) ?? null,
      upsert: async ({ where, create, update }: { where: { leadUid: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = verificationStore[where.leadUid] as Record<string, unknown> | undefined;
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
      update: async ({ where, data }: { where: { leadUid: string }; data: Record<string, unknown> }) => {
        const existing = (verificationStore[where.leadUid] as Record<string, unknown> | undefined) ?? {};
        const next = { ...existing, ...data };
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
    leadAllocation: trackLf2("leadAllocation"),
    deliveryAttempt: trackLf2("deliveryAttempt"),
    ghlLiveDeliveryRun: { count: async () => 0 },
    leadEligibilityAssessment: trackLf2("leadEligibilityAssessment"),
    fulfillmentOutbox: trackLf2("fulfillmentOutbox"),
    deliveryInstruction: trackLf2("deliveryInstruction"),
    leadOrder: trackLf2("leadOrder"),
    deliveryTarget: trackLf2("deliveryTarget"),
    leadVerificationApprovalAuditEvent: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditEvents.push(data);
        writes.push("audit");
        return { id: `audit_${auditEvents.length}`, ...data };
      },
    },
    $transaction: async <T>(fn: (tx: TestDb) => Promise<T>) => fn(db),
    ...(overrides as Partial<TestDb>),
  };

  return { db: db as never, writes, lf2Writes, verificationStore, auditEvents };
}

test("fingerprintIdentityValue normalizes email case", () => {
  assert.equal(
    fingerprintIdentityValue("email", "Lead@Example.COM"),
    fingerprintIdentityValue("email", "lead@example.com")
  );
});

test("1. no_duplicate_found writes PASSED + UNIQUE", async () => {
  const { db, verificationStore } = makeDb();
  const result = await approveLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    authDeps(async () => ({ ok: true, summary: noDuplicateSummary }))
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.newVerificationStatus, "PASSED");
    assert.equal(result.newDuplicateStatus, "UNIQUE");
    assert.equal(result.approvalStatus, "applied");
  }
  assert.equal((verificationStore[baseEvent.sourceLeadUid] as { duplicateStatus: string }).duplicateStatus, "UNIQUE");
});

test("2. post-approval duplicate verification passes but proof review may still be required", async () => {
  const evaluation = evaluateLeadEligibility({
    sourceLeadEvent: baseEvent as never,
    leadProof: null,
    verification: { duplicateStatus: "UNIQUE", verificationStatus: "PASSED" },
    leadState: "Texas",
  });
  assert.equal(evaluation.status, "review_required");
  assert.equal(evaluation.reasonCodes.includes("proof_review_required"), true);
  assert.equal(evaluation.reasonCodes.includes("duplicate_unchecked"), false);

  const preview = await buildEligibilityPreviewForSourceLead(CANDIDATE_EVENT_ID, {
    sourceLeadEvent: { findUnique: async () => baseEvent },
    leadProof: { findUnique: async () => null },
    leadVerificationResult: {
      findUnique: async () => ({
        duplicateStatus: "UNIQUE",
        verificationStatus: "PASSED",
      }),
    },
  } as never);
  assert.equal(preview.ok, true);
  if (preview.ok) {
    assert.equal(preview.preview.predictedEligibilityStatus, "review_required");
    assert.equal(preview.preview.predictedReasonCodes.includes("proof_review_required"), true);
    assert.equal(preview.preview.duplicateStatus, "UNIQUE");
    assert.equal(preview.preview.verificationStatus, "PASSED");
    assert.equal(preview.preview.verificationPresent, true);
  }
});

test("3. audit event is written with no raw phone/email", async () => {
  const { db, auditEvents } = makeDb();
  await approveLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    authDeps(async () => ({ ok: true, summary: noDuplicateSummary }))
  );
  const audit = auditEvents[0];
  assert.ok(audit);
  assert.equal("phone" in audit, false);
  assert.equal("email" in audit, false);
  assert.ok(audit.phoneFingerprint);
  assert.ok(audit.emailFingerprint);
  assert.equal(String(audit.phoneFingerprint).includes("+1"), false);
});

test("4. route body cannot override client/location/status — service ignores caller-supplied values", async () => {
  const { db } = makeDb();
  const result = await approveLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID, operatorNote: "note only" },
    db,
    authDeps(async () => ({ ok: true, summary: noDuplicateSummary }))
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.clientAccountId, CANDIDATE_CLIENT);
    assert.equal(result.destinationSubaccountIdGhl, CANDIDATE_DESTINATION);
  }
});

test("5. missing source lead rejects", async () => {
  const { db } = makeDb();
  const result = await approveLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: "missing" },
    db,
    { findSourceLeadEventById: (async () => null) as unknown as typeof findSourceLeadEventById }
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "source_lead_not_found");
});

test("6. missing sourceLeadUid rejects", async () => {
  const { db } = makeDb();
  const result = await approveLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    {
      findSourceLeadEventById: (async () => ({ ...baseEvent, sourceLeadUid: null })) as unknown as typeof findSourceLeadEventById,
    }
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "source_lead_uid_missing");
});

test("7. missing client rejects", async () => {
  const { db } = makeDb();
  const result = await approveLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    {
      findSourceLeadEventById: (async () => ({ ...baseEvent, clientAccountIdResolved: null })) as unknown as typeof findSourceLeadEventById,
    }
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "client_account_missing");
});

test("8. missing destination rejects", async () => {
  const { db } = makeDb();
  const result = await approveLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    {
      findSourceLeadEventById: (async () => baseEvent) as unknown as typeof findSourceLeadEventById,
      findClientAccountById: (async () => ({ clientAccountId: CANDIDATE_CLIENT, ghlDestination: null })) as unknown as typeof findClientAccountById,
    }
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "destination_missing");
});

test("9. missing identity rejects", async () => {
  const { db } = makeDb();
  const result = await approveLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    {
      ...authDeps(async () => ({ ok: true, summary: noDuplicateSummary })),
      findSourceLeadEventById: (async () => ({
        ...baseEvent,
        normalizedPayloadJson: { contact: { state: "Texas" } },
      })) as unknown as typeof findSourceLeadEventById,
    }
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "identity_missing");
});

test("10. duplicate_risk rejects and writes no verification", async () => {
  const { db, verificationStore, auditEvents } = makeDb();
  const result = await approveLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    authDeps(async () => ({
      ok: true,
      summary: { ...noDuplicateSummary, classification: "duplicate_risk", reasonCode: "partial_identity_match" },
    }))
  );
  assert.equal(result.ok, false);
  assert.equal(verificationStore[baseEvent.sourceLeadUid], undefined);
  assert.equal(auditEvents[0]?.approvalStatus, "rejected");
});

test("11. unable_to_verify rejects and writes no verification", async () => {
  const { db, verificationStore } = makeDb();
  const result = await approveLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    authDeps(async () => ({
      ok: true,
      summary: { ...noDuplicateSummary, classification: "unable_to_verify", reasonCode: "phone_search_unverifiable" },
    }))
  );
  assert.equal(result.ok, false);
  assert.equal(verificationStore[baseEvent.sourceLeadUid], undefined);
});

test("12. existing duplicate blocked status rejects", async () => {
  const { db, verificationStore } = makeDb();
  verificationStore[baseEvent.sourceLeadUid] = {
    verificationStatus: "FAILED",
    duplicateStatus: "DUPLICATE_GLOBAL",
  };
  const result = await approveLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    authDeps(async () => ({ ok: true, summary: noDuplicateSummary }))
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "verification_blocked");
});

test("13. idempotent replay behavior is safe", async () => {
  const { db, verificationStore } = makeDb();
  verificationStore[baseEvent.sourceLeadUid] = {
    verificationStatus: "PASSED",
    duplicateStatus: "UNIQUE",
    phoneStatus: "verified_unique",
    emailStatus: "verified_unique",
  };
  let searchCalls = 0;
  const result = await approveLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID, requestId: "req-approve-1" },
    db,
    authDeps(async () => {
      searchCalls += 1;
      return { ok: true, summary: noDuplicateSummary };
    })
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.approvalStatus, "idempotent_replay");
    assert.equal(searchCalls, 1);
  }
});

test("13b. prior UNIQUE rejected when authoritative search no longer clear", async () => {
  const { db, verificationStore } = makeDb();
  verificationStore[baseEvent.sourceLeadUid] = {
    verificationStatus: "PASSED",
    duplicateStatus: "UNIQUE",
  };
  const result = await approveLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    authDeps(async () => ({
      ok: true,
      summary: { ...noDuplicateSummary, classification: "duplicate_risk", reasonCode: "partial_identity_match" },
    }))
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "duplicate_search_not_clear");
});

test("14. prior delivery evidence rejects", async () => {
  const { db } = makeDb();
  const result = await approveLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    {
      ...authDeps(async () => ({ ok: true, summary: noDuplicateSummary })),
      findSourceLeadEventById: (async () => ({
        ...baseEvent,
        deliveredAt: new Date("2026-07-01T00:00:00.000Z"),
      })) as unknown as typeof findSourceLeadEventById,
    }
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "prior_delivery_evidence");
});

test("15. GHL search is mocked, never real", async () => {
  let called = false;
  const { db } = makeDb();
  await approveLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    authDeps(async () => {
      called = true;
      return { ok: true, summary: noDuplicateSummary };
    })
  );
  assert.equal(called, true);
});

test("21. LF2 tables remain unchanged by verification approval", async () => {
  const { db, lf2Writes } = makeDb();
  await approveLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    authDeps(async () => ({ ok: true, summary: noDuplicateSummary }))
  );
  assert.deepEqual(lf2Writes, []);
});

test("22. approved verification can be downgraded to review", async () => {
  const { db, verificationStore } = makeDb();
  verificationStore[baseEvent.sourceLeadUid] = {
    verificationStatus: "PASSED",
    duplicateStatus: "UNIQUE",
  };
  const result = await revokeLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    {
      findSourceLeadEventById: (async () => baseEvent) as unknown as typeof findSourceLeadEventById,
      findClientAccountById: (async () => clientWithDestination) as unknown as typeof findClientAccountById,
      buildEligibilityPreview: async () => ({
        ok: true as const,
        preview: {
          ...eligiblePreview,
          duplicateStatus: "POSSIBLE_MATCH",
          verificationStatus: "NEEDS_REVIEW",
          predictedEligibilityStatus: "review_required",
          predictedReasonCodes: ["duplicate_review_required"],
          summaries: {
            ...eligiblePreview.summaries,
            duplicateRequiresReview: true,
          },
        },
      }),
    }
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.newVerificationStatus, "NEEDS_REVIEW");
    assert.equal(result.newDuplicateStatus, "POSSIBLE_MATCH");
  }
});

test("23. revoke writes audit event", async () => {
  const { db, verificationStore, auditEvents } = makeDb();
  verificationStore[baseEvent.sourceLeadUid] = {
    verificationStatus: "PASSED",
    duplicateStatus: "UNIQUE",
  };
  await revokeLf2DuplicateVerificationForSourceLead({ sourceLeadEventId: CANDIDATE_EVENT_ID }, db, {
    findSourceLeadEventById: (async () => baseEvent) as unknown as typeof findSourceLeadEventById,
    findClientAccountById: (async () => clientWithDestination) as unknown as typeof findClientAccountById,
    buildEligibilityPreview: async () => ({ ok: true as const, preview: eligiblePreview }),
  });
  assert.equal(auditEvents[0]?.actionType, "REVOKE_TO_REVIEW");
});

test("24. revoke is idempotent", async () => {
  const { db, verificationStore } = makeDb();
  verificationStore[baseEvent.sourceLeadUid] = {
    verificationStatus: "NEEDS_REVIEW",
    duplicateStatus: "POSSIBLE_MATCH",
  };
  const result = await revokeLf2DuplicateVerificationForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID, requestId: "req-revoke-1" },
    db,
    {
      findSourceLeadEventById: (async () => baseEvent) as unknown as typeof findSourceLeadEventById,
      findClientAccountById: (async () => clientWithDestination) as unknown as typeof findClientAccountById,
      buildEligibilityPreview: async () => ({ ok: true as const, preview: eligiblePreview }),
    }
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.revocationStatus, "idempotent_replay");
});

test("25. revoke does not touch LF2 rows or GHL", async () => {
  const { db, verificationStore, lf2Writes } = makeDb();
  verificationStore[baseEvent.sourceLeadUid] = {
    verificationStatus: "PASSED",
    duplicateStatus: "UNIQUE",
  };
  await revokeLf2DuplicateVerificationForSourceLead({ sourceLeadEventId: CANDIDATE_EVENT_ID }, db, {
    findSourceLeadEventById: (async () => baseEvent) as unknown as typeof findSourceLeadEventById,
    findClientAccountById: (async () => clientWithDestination) as unknown as typeof findClientAccountById,
    buildEligibilityPreview: async () => ({ ok: true as const, preview: eligiblePreview }),
  });
  assert.deepEqual(lf2Writes, []);
});
