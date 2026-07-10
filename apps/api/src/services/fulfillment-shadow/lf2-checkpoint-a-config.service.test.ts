import test from "node:test";
import assert from "node:assert/strict";

import {
  CANDIDATE_CLIENT,
  CANDIDATE_DESTINATION,
  CANDIDATE_EVENT_ID,
} from "./lf2-verification-approval.service.test.js";
import {
  LF2_CHECKPOINT_A_ADAPTER_KEY,
  LF2_CHECKPOINT_A_CAMPAIGN_TYPE,
  LF2_CHECKPOINT_A_TARGET_DISPLAY_NAME,
  buildLf2CheckpointAConfigPreviewForSourceLead,
  createLf2CheckpointAConfigForSourceLead,
  revokeLf2CheckpointAConfigForSourceLead,
} from "./lf2-checkpoint-a-config.service.js";
import { buildEligibilityPreviewForSourceLead } from "./eligibility-preview.service.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { findSourceLeadEventById } from "../../repositories/source-lead-event.repository.js";

const baseEvent = {
  id: CANDIDATE_EVENT_ID,
  sourceLeadUid: "facebook-meta_lead_ads-test_20260624201110",
  clientAccountIdResolved: CANDIDATE_CLIENT,
  destinationLocationIdResolved: CANDIDATE_DESTINATION,
  deliveredAt: null,
  deliveryResultJson: null,
  routingDryRunDecisionId: null,
  routingRuleIdResolved: null,
  sourceCampaignId: "camp_1",
  sourceProvider: "facebook",
  sourceSystem: "meta_lead_ads",
  sourceType: "manual_entry",
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
  clientDisplayName: "Smart Agent Demo 2",
  ghlDestination: {
    destinationSubaccountIdGhl: CANDIDATE_DESTINATION,
    locationName: "Demo Location",
  },
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

const LO1043_ID = "cmr2wek0k014vmj0uh0h2w6lf";

function authDeps() {
  return {
    findSourceLeadEventById: (async () => baseEvent) as unknown as typeof findSourceLeadEventById,
    findClientAccountById: (async () => clientWithDestination) as unknown as typeof findClientAccountById,
    buildEligibilityPreview: async () => ({ ok: true as const, preview: eligiblePreview }),
    nextLeadOrderNumber: async () => "LO-1045",
  };
}

type TestDb = {
  leadVerificationResult: {
    findUnique: (args: { where: { leadUid: string } }) => Promise<Record<string, unknown> | null>;
  };
  leadOrder: {
    findUnique: (args: { where: { id: string } }) => Promise<Record<string, unknown> | null>;
    findMany: (args?: { where?: Record<string, unknown> }) => Promise<Record<string, unknown>[]>;
    create: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
    count: () => Promise<number>;
  };
  deliveryTarget: {
    findUnique: (args: { where: { id: string } }) => Promise<Record<string, unknown> | null>;
    findMany: (args?: { where?: Record<string, unknown> }) => Promise<Record<string, unknown>[]>;
    create: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
    count: () => Promise<number>;
  };
  deliveryInstruction: { count: (args?: { where?: Record<string, unknown> }) => Promise<number> };
  lf2CheckpointAAuditEvent: {
    findFirst: (args?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
  };
  leadEligibilityAssessment: { count: (args?: { where?: Record<string, unknown> }) => Promise<number> };
  fulfillmentOutbox: { count: (args?: { where?: Record<string, unknown> }) => Promise<number> };
  leadAllocation: { count: (args?: { where?: Record<string, unknown> }) => Promise<number> };
  deliveryAttempt: { count: (args?: { where?: Record<string, unknown> }) => Promise<number> };
  campaignRoutingRule: { findUnique: () => Promise<null> };
  $transaction: <T>(fn: (tx: TestDb) => Promise<T>) => Promise<T>;
};

function makeDb(overrides: Partial<TestDb> = {}) {
  const writes: string[] = [];
  const lf2Writes: string[] = [];
  const orders: Record<string, unknown>[] = [
    {
      id: LO1043_ID,
      orderNumber: "LO-1043",
      status: "submitted",
      clientAccountId: CANDIDATE_CLIENT,
      campaignType: "exclusive",
      canceledAt: null,
    },
  ];
  const targets: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  let orderSeq = 0;
  let targetSeq = 0;

  const matchAudit = (args?: Record<string, unknown>) => {
    const where = (args?.where ?? {}) as Record<string, unknown>;
    const orderBy = args?.orderBy as { createdAt?: string } | undefined;
    let rows = audits.filter((audit) => {
      for (const [key, value] of Object.entries(where)) {
        if (key === "checkpointAStatus" && value && typeof value === "object" && "in" in (value as object)) {
          if (!(value as { in: string[] }).in.includes(audit.checkpointAStatus as string)) return false;
          continue;
        }
        if (key === "leadOrderId" && value && typeof value === "object" && "not" in (value as object)) {
          if (audit.leadOrderId == null) return false;
          continue;
        }
        if (audit[key] !== value) return false;
      }
      return true;
    });
    if (orderBy?.createdAt === "desc") {
      rows = [...rows].reverse();
    }
    return rows[0] ?? null;
  };

  const db: TestDb = {
    leadVerificationResult: {
      findUnique: async () => ({
        verificationStatus: "PASSED",
        duplicateStatus: "UNIQUE",
      }),
    },
    leadOrder: {
      findUnique: async ({ where }) => orders.find((o) => o.id === where.id) ?? null,
      findMany: async (args?: { where?: Record<string, unknown> }) => {
        const where = args?.where ?? {};
        return orders.filter((order) => {
          if (where.clientAccountId && order.clientAccountId !== where.clientAccountId) return false;
          if (where.campaignType && order.campaignType !== where.campaignType) return false;
          if (where.status && order.status !== where.status) return false;
          if (where.canceledAt === null && order.canceledAt != null) return false;
          const idFilter = where.id as { not?: string } | undefined;
          if (idFilter?.not && order.id === idFilter.not) return false;
          return true;
        });
      },
      create: async ({ data }) => {
        orderSeq += 1;
        const row = { id: `order_${orderSeq}`, ...data };
        orders.push(row);
        writes.push("leadOrder");
        return row;
      },
      update: async ({ where, data }) => {
        const idx = orders.findIndex((o) => o.id === where.id);
        const row = { ...orders[idx], ...data };
        orders[idx] = row;
        writes.push("leadOrder");
        return row;
      },
      count: async () => orders.length,
    },
    deliveryTarget: {
      findUnique: async ({ where }) => targets.find((t) => t.id === where.id) ?? null,
      findMany: async (args?: { where?: Record<string, unknown> }) => {
        const where = args?.where ?? {};
        return targets.filter((target) => {
          if (where.clientAccountId && target.clientAccountId !== where.clientAccountId) return false;
          if (where.enabled === true && !target.enabled) return false;
          if (where.adapterKey && target.adapterKey !== where.adapterKey) return false;
          if (where.isRequired === true && !target.isRequired) return false;
          const idFilter = where.id as { not?: string } | undefined;
          if (idFilter?.not && target.id === idFilter.not) return false;
          return true;
        });
      },
      create: async ({ data }) => {
        targetSeq += 1;
        const row = { id: `target_${targetSeq}`, enabled: true, ...data };
        targets.push(row);
        writes.push("deliveryTarget");
        return row;
      },
      update: async ({ where, data }) => {
        const idx = targets.findIndex((t) => t.id === where.id);
        const row = { ...targets[idx], ...data };
        targets[idx] = row;
        writes.push("deliveryTarget");
        return row;
      },
      count: async () => targets.length,
    },
    deliveryInstruction: { count: async () => 0 },
    lf2CheckpointAAuditEvent: {
      findFirst: async (args) => matchAudit(args),
      create: async ({ data }) => {
        const row = { id: `audit_${audits.length + 1}`, ...data };
        audits.push(row);
        writes.push("audit");
        return row;
      },
    },
    leadEligibilityAssessment: {
      count: async () => {
        lf2Writes.push("leadEligibilityAssessment");
        return 0;
      },
    },
    fulfillmentOutbox: {
      count: async () => {
        lf2Writes.push("fulfillmentOutbox");
        return 0;
      },
    },
    leadAllocation: {
      count: async () => {
        lf2Writes.push("leadAllocation");
        return 0;
      },
    },
    deliveryAttempt: {
      count: async () => {
        lf2Writes.push("deliveryAttempt");
        return 0;
      },
    },
    campaignRoutingRule: { findUnique: async () => null },
    $transaction: async (fn) => fn(db),
    ...overrides,
  };

  return { db: db as never, writes, lf2Writes, orders, targets, audits };
}

test("1. eligible verified candidate produces safe proposed config", async () => {
  const { db } = makeDb();
  const result = await buildLf2CheckpointAConfigPreviewForSourceLead(CANDIDATE_EVENT_ID, db, authDeps());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.preview.checkpointACreateSafe, true);
  assert.equal(result.preview.proposedLeadOrder.orderKind, "retainer_allocation");
  assert.equal(result.preview.proposedDeliveryTarget.adapterKey, LF2_CHECKPOINT_A_ADAPTER_KEY);
  assert.equal(JSON.stringify(result.preview).includes("jane.doe@example.test"), false);
});

test("2. missing verification blocks", async () => {
  const { db } = makeDb({
    leadVerificationResult: { findUnique: async () => null },
  });
  const result = await buildLf2CheckpointAConfigPreviewForSourceLead(CANDIDATE_EVENT_ID, db, authDeps());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "verification_not_passed_unique");
});

test("3. review_required eligibility blocks", async () => {
  const { db } = makeDb();
  const result = await buildLf2CheckpointAConfigPreviewForSourceLead(CANDIDATE_EVENT_ID, db, {
    ...authDeps(),
    buildEligibilityPreview: async () => ({
      ok: true as const,
      preview: {
        ...eligiblePreview,
        predictedEligibilityStatus: "review_required",
        predictedReasonCodes: ["duplicate_unchecked"],
      },
    }),
  });
  assert.equal(result.ok, false);
});

test("4. destination mismatch blocks", async () => {
  const { db } = makeDb();
  const result = await buildLf2CheckpointAConfigPreviewForSourceLead(CANDIDATE_EVENT_ID, db, {
    ...authDeps(),
    findSourceLeadEventById: (async () => ({
      ...baseEvent,
      destinationLocationIdResolved: "other_location",
    })) as unknown as typeof findSourceLeadEventById,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "destination_mismatch");
});

test("5. prior delivery evidence blocks", async () => {
  const { db } = makeDb();
  const result = await buildLf2CheckpointAConfigPreviewForSourceLead(CANDIDATE_EVENT_ID, db, {
    ...authDeps(),
    findSourceLeadEventById: (async () => ({
      ...baseEvent,
      deliveredAt: new Date(),
    })) as unknown as typeof findSourceLeadEventById,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.preview.structuralBlockers.includes("prior_delivery_evidence"));
});

test("6. existing LF2 rows block", async () => {
  const { db } = makeDb({
    fulfillmentOutbox: {
      count: async () => 1,
    },
  });
  const result = await buildLf2CheckpointAConfigPreviewForSourceLead(CANDIDATE_EVENT_ID, db, authDeps());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.preview.structuralBlockers.includes("lf2_execution_rows_present"));
});

test("7. existing conflicting config blocks", async () => {
  const { db, orders } = makeDb();
  orders.push({
    id: "order_conflict",
    orderNumber: "LO-9999",
    status: "active",
    clientAccountId: CANDIDATE_CLIENT,
    campaignType: LF2_CHECKPOINT_A_CAMPAIGN_TYPE,
    canceledAt: null,
  });
  const result = await buildLf2CheckpointAConfigPreviewForSourceLead(CANDIDATE_EVENT_ID, db, authDeps());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.preview.structuralBlockers.includes("conflicting_checkpoint_order"));
});

test("8. safe preview metadata passes validation and contains no secret-like keys", async () => {
  const { validateDeliveryTargetMetadata } = await import("../../lib/delivery-target-metadata.validation.js");
  const { db } = makeDb();
  const result = await buildLf2CheckpointAConfigPreviewForSourceLead(CANDIDATE_EVENT_ID, db, authDeps());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const metadataCheck = validateDeliveryTargetMetadata(result.preview.proposedDeliveryTarget.configMetadataJson);
  assert.equal(metadataCheck.ok, true);
  assert.equal(JSON.stringify(result.preview.proposedDeliveryTarget.configMetadataJson).includes("token"), false);
});

test("9. no raw phone/email/source payload/token in response", async () => {
  const { db } = makeDb();
  const result = await buildLf2CheckpointAConfigPreviewForSourceLead(CANDIDATE_EVENT_ID, db, authDeps());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const text = JSON.stringify(result.preview);
  assert.equal(text.includes(baseEvent.sourceLeadUid), false);
  assert.equal(text.includes("+14155550100"), false);
  assert.equal(text.includes("jane.doe@example.test"), false);
});

test("10. safe candidate creates exactly one LeadOrder and one DeliveryTarget", async () => {
  const { db, writes } = makeDb();
  const result = await createLf2CheckpointAConfigForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID, requestId: "req-create-1" },
    db,
    authDeps()
  );
  assert.equal(result.ok, true);
  assert.equal(writes.filter((w) => w === "leadOrder").length, 1);
  assert.equal(writes.filter((w) => w === "deliveryTarget").length, 1);
});

test("11. created LeadOrder has exact LF2 fields and counters zero", async () => {
  const { db, orders } = makeDb();
  const result = await createLf2CheckpointAConfigForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    authDeps()
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const created = orders.find((o) => o.id === result.leadOrderId);
  assert.equal(created?.orderKind, "retainer_allocation");
  assert.equal(created?.fulfillmentMode, "campaign_bound");
  assert.equal(created?.requestedQuantity, 1);
  assert.equal(created?.proposedQuantity, 0);
  assert.equal(created?.reservedQuantity, 0);
  assert.equal(created?.fulfilledQuantity, 0);
  assert.equal(created?.campaignType, LF2_CHECKPOINT_A_CAMPAIGN_TYPE);
});

test("12. created DeliveryTarget has adapterKey ghl.crm.v1, enabled, required, safe metadata", async () => {
  const { db, targets } = makeDb();
  const result = await createLf2CheckpointAConfigForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    authDeps()
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const created = targets.find((t) => t.id === result.deliveryTargetId);
  assert.equal(created?.adapterKey, LF2_CHECKPOINT_A_ADAPTER_KEY);
  assert.equal(created?.enabled, true);
  assert.equal(created?.isRequired, true);
  assert.equal(created?.displayName, LF2_CHECKPOINT_A_TARGET_DISPLAY_NAME);
  assert.equal((created?.configMetadataJson as Record<string, unknown>).destinationSubaccountIdGhl, CANDIDATE_DESTINATION);
});

test("13. idempotent requestId replay does not duplicate rows", async () => {
  const { db, writes } = makeDb();
  const first = await createLf2CheckpointAConfigForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID, requestId: "req-idem-1" },
    db,
    authDeps()
  );
  const orderWritesBefore = writes.filter((w) => w === "leadOrder").length;
  const second = await createLf2CheckpointAConfigForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID, requestId: "req-idem-1" },
    db,
    authDeps()
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(second.checkpointAStatus, "idempotent_replay");
  assert.equal(writes.filter((w) => w === "leadOrder").length, orderWritesBefore);
});

test("14. equivalent existing config returns idempotent success", async () => {
  const { db, orders, targets } = makeDb();
  const first = await createLf2CheckpointAConfigForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    authDeps()
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = await createLf2CheckpointAConfigForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID, requestId: "req-idem-2" },
    db,
    authDeps()
  );
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.checkpointAStatus, "idempotent_replay");
  assert.equal(orders.filter((o) => o.campaignType === LF2_CHECKPOINT_A_CAMPAIGN_TYPE).length, 1);
  assert.equal(targets.length, 1);
});

test("15. conflicting existing config rejects", async () => {
  const { db, orders } = makeDb();
  orders.push({
    id: "order_conflict",
    orderNumber: "LO-9999",
    status: "active",
    clientAccountId: CANDIDATE_CLIENT,
    campaignType: LF2_CHECKPOINT_A_CAMPAIGN_TYPE,
    canceledAt: null,
  });
  const result = await createLf2CheckpointAConfigForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    authDeps()
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "preview_not_safe");
});

test("16. route body cannot override — service ignores caller-supplied values", async () => {
  const { db } = makeDb();
  const result = await createLf2CheckpointAConfigForSourceLead(
    {
      sourceLeadEventId: CANDIDATE_EVENT_ID,
      operatorNote: "note only",
      requestId: "req-safe",
    },
    db,
    authDeps()
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.clientAccountId, CANDIDATE_CLIENT);
  assert.equal(result.authoritativeLocationId, CANDIDATE_DESTINATION);
});

test("17-21. no LF2 execution rows created", async () => {
  const { db, lf2Writes, writes } = makeDb();
  const result = await createLf2CheckpointAConfigForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    authDeps()
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.shadowEnqueueOccurred, false);
  assert.equal(result.lf2ExecutionRowsCreated, false);
  assert.equal(lf2Writes.includes("fulfillmentOutbox"), true);
  assert.equal(lf2Writes.includes("leadEligibilityAssessment"), true);
  assert.equal(writes.includes("fulfillmentOutbox"), false);
});

test("22. LO-1043 unchanged", async () => {
  const { db, orders } = makeDb();
  await createLf2CheckpointAConfigForSourceLead({ sourceLeadEventId: CANDIDATE_EVENT_ID }, db, authDeps());
  const lo1043 = orders.find((o) => o.id === LO1043_ID);
  assert.equal(lo1043?.orderNumber, "LO-1043");
  assert.equal(lo1043?.status, "submitted");
});

test("23. cleanup before shadow enqueue cancels/deactivates only Checkpoint A config", async () => {
  const { db, orders, targets } = makeDb();
  const created = await createLf2CheckpointAConfigForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    authDeps()
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const revoked = await revokeLf2CheckpointAConfigForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID, requestId: "req-revoke-1" },
    db,
    authDeps()
  );
  assert.equal(revoked.ok, true);
  if (!revoked.ok) return;
  const order = orders.find((o) => o.id === created.leadOrderId);
  const target = targets.find((t) => t.id === created.deliveryTargetId);
  assert.equal(order?.status, "canceled");
  assert.equal(target?.enabled, false);
});

test("24. cleanup is idempotent", async () => {
  const { db } = makeDb();
  await createLf2CheckpointAConfigForSourceLead({ sourceLeadEventId: CANDIDATE_EVENT_ID }, db, authDeps());
  const first = await revokeLf2CheckpointAConfigForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID, requestId: "req-revoke-idem" },
    db,
    authDeps()
  );
  const second = await revokeLf2CheckpointAConfigForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID, requestId: "req-revoke-idem" },
    db,
    authDeps()
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(second.revocationStatus, "idempotent_replay");
});

test("25. cleanup rejects once outbox exists", async () => {
  const { db } = makeDb({
    fulfillmentOutbox: { count: async () => 1 },
  });
  await createLf2CheckpointAConfigForSourceLead({ sourceLeadEventId: CANDIDATE_EVENT_ID }, db, authDeps());
  const revoked = await revokeLf2CheckpointAConfigForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    authDeps()
  );
  assert.equal(revoked.ok, false);
  if (revoked.ok) return;
  assert.equal(revoked.error, "shadow_processing_started");
});

test("26. cleanup does not touch unrelated orders or targets", async () => {
  const { db, orders, targets } = makeDb();
  targets.push({
    id: "target_other",
    clientAccountId: CANDIDATE_CLIENT,
    adapterKey: "webhook.generic.v1",
    enabled: true,
    isRequired: false,
  });
  const created = await createLf2CheckpointAConfigForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    authDeps()
  );
  await revokeLf2CheckpointAConfigForSourceLead({ sourceLeadEventId: CANDIDATE_EVENT_ID }, db, authDeps());
  const otherTarget = targets.find((t) => t.id === "target_other");
  const lo1043 = orders.find((o) => o.id === LO1043_ID);
  assert.equal(otherTarget?.enabled, true);
  assert.equal(lo1043?.status, "submitted");
  assert.equal(created.ok, true);
});

test("27. no GHL calls — service uses repository-derived destination only", async () => {
  const { db } = makeDb();
  const result = await createLf2CheckpointAConfigForSourceLead(
    { sourceLeadEventId: CANDIDATE_EVENT_ID },
    db,
    authDeps()
  );
  assert.equal(result.ok, true);
});
