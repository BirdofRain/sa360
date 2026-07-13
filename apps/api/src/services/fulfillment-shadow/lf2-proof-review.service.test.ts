import test from "node:test";
import assert from "node:assert/strict";

import { findSourceLeadEventById } from "../../repositories/source-lead-event.repository.js";
import {
  LF2_PROOF_REVIEW_APPROVE_CONFIRMATION,
  LF2_PROOF_REVIEW_REJECT_CONFIRMATION,
  LF2_PROOF_REVIEW_REVOKE_CONFIRMATION,
} from "./lf2-proof-review.constants.js";
import { buildLf2ProofReviewPreviewForSourceLead } from "./lf2-proof-review-preview.service.js";
import {
  approveLf2ProofReviewForSourceLead,
  rejectLf2ProofReviewForSourceLead,
  revokeLf2ProofReviewForSourceLead,
} from "./lf2-proof-review.service.js";
import { EXECUTION_MODE_LIVE, EXECUTION_MODE_SIMULATION } from "../fulfillment-execution/fulfillment-execution.constants.js";

const EVENT_ID = "evt_proof_review_1";
const LEAD_UID = "facebook-meta_lead_ads-leadgen_123";
const CLIENT_ID = "client_proof_1";

const baseEvent = {
  id: EVENT_ID,
  sourceLeadUid: LEAD_UID,
  clientAccountIdResolved: CLIENT_ID,
  sourceLeadId: "leadgen_123",
  sourceCampaignId: "camp_1",
  sourceCampaignName: "Camp",
  sourceFunnelName: "Form A",
  deliveredAt: null,
  deliveryResultJson: null,
  routingDryRunDecisionId: null,
  sourceProvider: "facebook",
  sourceSystem: "meta_lead_ads",
  normalizedPayloadJson: {
    contact: {
      lead_uid: LEAD_UID,
      phone_e164: "+14155550100",
      email: "jane.doe@example.test",
      state: "Texas",
    },
    attribution: {
      source_platform: "facebook",
      source_type: "facebook_lead_form",
      campaign_id: "camp_1",
      source_lead_id: "leadgen_123",
    },
    routing: { form_id: "form_1", form_name: "Form A" },
    submitted_at: "2026-07-01T00:00:00.000Z",
    consent: { consent_text: "I agree", consent_version: "v1" },
  },
  rawPayloadJson: {},
  enrichmentMetadataJson: null,
  receivedAt: new Date("2026-07-01T00:00:00.000Z"),
};

const passedUniqueVerification = {
  id: "ver_1",
  leadUid: LEAD_UID,
  verificationStatus: "PASSED",
  duplicateStatus: "UNIQUE",
  phoneStatus: "verified_unique",
  emailStatus: "verified_unique",
  suppressionStatus: null,
  qualityScore: null,
  reasons: [],
  checkedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

type AuditRow = Record<string, unknown>;

function makeDb(overrides: Record<string, unknown> = {}) {
  const writes: string[] = [];
  const proofStore: Record<string, unknown> = {};
  const snapshotStore: Record<string, unknown> = {};
  const verificationStore: Record<string, unknown> = { [LEAD_UID]: passedUniqueVerification };
  const auditStore = new Map<string, AuditRow>();
  const auditList: AuditRow[] = [];

  const db: {
    sourceLeadEvent: { findUnique: () => Promise<typeof baseEvent> };
    leadProof: {
      findUnique: (args: { where: { leadUid: string } }) => Promise<Record<string, unknown> | null>;
      upsert: (args: {
        where: { leadUid: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => Promise<Record<string, unknown>>;
    };
    leadProofArtifact: { upsert: () => Promise<{ id: string }> };
    leadSourceSnapshot: {
      upsert: (args: {
        where: { leadUid: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => Promise<Record<string, unknown>>;
    };
    leadVerificationResult: {
      findUnique: (args: { where: { leadUid: string } }) => Promise<Record<string, unknown> | null>;
    };
    leadAllocation: { findFirst: () => Promise<Record<string, unknown>> };
    deliveryAttempt: { findMany: () => Promise<Array<{ executionMode: string; status: string }>> };
    ghlLiveDeliveryRun: { count: () => Promise<number> };
    leadProofReviewAuditEvent: {
      findUnique: (args: {
        where: { sourceLeadEventId_requestId: { sourceLeadEventId: string; requestId: string } };
      }) => Promise<AuditRow | null>;
      findFirst: (args: { where: Record<string, unknown> }) => Promise<AuditRow | null>;
      create: (args: { data: AuditRow }) => Promise<AuditRow & { id: string }>;
    };
    $transaction: <T>(fn: (tx: typeof db) => Promise<T>) => Promise<T>;
    _writes: string[];
    _proofStore: Record<string, unknown>;
    _auditList: AuditRow[];
  } = {
    sourceLeadEvent: {
      findUnique: async () => baseEvent,
    },
    leadProof: {
      findUnique: async ({ where }: { where: { leadUid: string } }) => {
        const row = proofStore[where.leadUid] as Record<string, unknown> | undefined;
        if (!row) return null;
        return { ...row, proofArtifacts: [] };
      },
      upsert: async ({ where, create, update }: { where: { leadUid: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = proofStore[where.leadUid] as Record<string, unknown> | undefined;
        const next = existing ? { ...existing, ...update } : create;
        proofStore[where.leadUid] = next;
        writes.push("leadProof");
        return { id: "proof_1", ...next };
      },
    },
    leadProofArtifact: {
      upsert: async () => {
        writes.push("leadProofArtifact");
        return { id: "artifact_1" };
      },
    },
    leadSourceSnapshot: {
      upsert: async ({ where, create, update }: { where: { leadUid: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = snapshotStore[where.leadUid] as Record<string, unknown> | undefined;
        const next = existing ? { ...existing, ...update } : create;
        snapshotStore[where.leadUid] = next;
        writes.push("leadSourceSnapshot");
        return next;
      },
    },
    leadVerificationResult: {
      findUnique: async ({ where }: { where: { leadUid: string } }) =>
        (verificationStore[where.leadUid] as Record<string, unknown> | undefined) ?? null,
    },
    leadAllocation: {
      findFirst: async () => ({
        id: "alloc_1",
        status: "reserved",
        committedAt: null,
        leadOrder: { fulfilledQuantity: 0 },
      }),
    },
    deliveryAttempt: {
      findMany: async () => [
        { executionMode: EXECUTION_MODE_SIMULATION, status: "succeeded" },
      ],
    },
    ghlLiveDeliveryRun: { count: async () => 0 },
    leadProofReviewAuditEvent: {
      findUnique: async ({ where }: { where: { sourceLeadEventId_requestId: { sourceLeadEventId: string; requestId: string } } }) =>
        auditStore.get(`${where.sourceLeadEventId_requestId.sourceLeadEventId}:${where.sourceLeadEventId_requestId.requestId}`) ?? null,
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.actionType === "APPROVE_PROOF") {
          return auditList.find((row) => row.actionType === "APPROVE_PROOF" && row.reviewStatus === "applied") ?? null;
        }
        return null;
      },
      create: async ({ data }: { data: AuditRow }) => {
        const key = `${String(data.sourceLeadEventId)}:${String(data.requestId)}`;
        if (auditStore.has(key)) throw Object.assign(new Error("unique"), { code: "P2002" });
        auditStore.set(key, data);
        auditList.push(data);
        writes.push("leadProofReviewAuditEvent");
        return { id: `audit_${auditList.length}`, ...data };
      },
    },
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>) => fn(db),
    _writes: writes,
    _proofStore: proofStore,
    _auditList: auditList,
    ...(overrides as Record<string, unknown>),
  };

  return db;
}

const deps = {
  findSourceLeadEventById: (async () => baseEvent) as unknown as typeof findSourceLeadEventById,
};

const approveBody = {
  sourceLeadEventId: EVENT_ID,
  requestId: "req_approve_1",
  operatorNote: "operator reviewed persisted meta evidence",
  operatorConfirmationText: LF2_PROOF_REVIEW_APPROVE_CONFIRMATION,
  requestedBy: "test_operator",
};

test("preview masks output and performs no writes", async () => {
  const db = makeDb();
  const writesBefore = db._writes.length;
  const result = await buildLf2ProofReviewPreviewForSourceLead(EVENT_ID, db as never);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.preview.maskedSourceLeadUid ?? "", /\*\*\*/);
  assert.equal(result.preview.proofPolicyKey, "meta_lead_ads");
  assert.equal(result.preview.canApprove, true);
  assert.equal(db._writes.length, writesBefore);
  assert.equal(JSON.stringify(result.preview).includes("jane.doe@example.test"), false);
});

test("approval creates missing LeadProof and LeadSourceSnapshot", async () => {
  const db = makeDb();
  const result = await approveLf2ProofReviewForSourceLead(approveBody, db as never);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.newProofStatus, "PROOF_ATTACHED");
  assert.equal(result.reviewStatus, "applied");
  assert.ok(db._proofStore[LEAD_UID]);
  assert.equal(db._writes.filter((w) => w === "leadProof").length, 1);
  assert.equal(db._writes.filter((w) => w === "leadSourceSnapshot").length, 1);
  assert.equal(db._writes.filter((w) => w === "leadProofReviewAuditEvent").length, 1);
});

test("approval idempotent replay does not duplicate proof or audit mutation", async () => {
  const db = makeDb();
  const first = await approveLf2ProofReviewForSourceLead(approveBody, db as never);
  assert.equal(first.ok, true);
  const proofWritesAfterFirst = db._writes.filter((w) => w === "leadProof").length;
  const second = await approveLf2ProofReviewForSourceLead(approveBody, db as never);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.reviewStatus, "idempotent_replay");
  assert.equal(db._writes.filter((w) => w === "leadProof").length, proofWritesAfterFirst);
});

test("approval rejects missing verification", async () => {
  const db = makeDb({
    leadVerificationResult: {
      findUnique: async () => null,
    },
  });
  const result = await approveLf2ProofReviewForSourceLead(approveBody, db as never);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "verification_missing");
});

test("approval rejects wrong confirmation text", async () => {
  const db = makeDb();
  const result = await approveLf2ProofReviewForSourceLead(
    { ...approveBody, operatorConfirmationText: "WRONG" },
    db as never
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "invalid_confirmation_text");
});

test("approval allows reserved allocation and succeeded simulation attempt", async () => {
  const db = makeDb();
  const preview = await buildLf2ProofReviewPreviewForSourceLead(EVENT_ID, db as never);
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.equal(preview.preview.simulationAttemptCount, 1);
  assert.equal(preview.preview.allocationStatus, "reserved");
  assert.equal(preview.preview.canApprove, true);
});

test("approval rejects committed allocation", async () => {
  const db = makeDb({
    leadAllocation: {
      findFirst: async () => ({
        id: "alloc_1",
        status: "committed",
        committedAt: new Date(),
        leadOrder: { fulfilledQuantity: 0 },
      }),
    },
  });
  const result = await approveLf2ProofReviewForSourceLead(approveBody, db as never);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "allocation_committed");
});

test("approval rejects live attempt", async () => {
  const db = makeDb({
    deliveryAttempt: {
      findMany: async () => [{ executionMode: EXECUTION_MODE_LIVE, status: "succeeded" }],
    },
  });
  const result = await approveLf2ProofReviewForSourceLead(approveBody, db as never);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "live_attempt_succeeded");
});

test("reject sets REJECTED without requiring verification", async () => {
  const db = makeDb({
    leadVerificationResult: { findUnique: async () => null },
  });
  const result = await rejectLf2ProofReviewForSourceLead(
    {
      ...approveBody,
      requestId: "req_reject_1",
      operatorConfirmationText: LF2_PROOF_REVIEW_REJECT_CONFIRMATION,
    },
    db as never
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.newProofStatus, "REJECTED");
});

test("revoke requires prior approval and sets NEEDS_REVIEW", async () => {
  const db = makeDb();
  const approved = await approveLf2ProofReviewForSourceLead(approveBody, db as never);
  assert.equal(approved.ok, true);
  const revoked = await revokeLf2ProofReviewForSourceLead(
    {
      ...approveBody,
      requestId: "req_revoke_1",
      operatorConfirmationText: LF2_PROOF_REVIEW_REVOKE_CONFIRMATION,
    },
    db as never
  );
  assert.equal(revoked.ok, true);
  if (!revoked.ok) return;
  assert.equal(revoked.newProofStatus, "NEEDS_REVIEW");
});

test("same requestId with different action fails closed", async () => {
  const db = makeDb();
  const approved = await approveLf2ProofReviewForSourceLead(approveBody, db as never);
  assert.equal(approved.ok, true);
  const rejected = await rejectLf2ProofReviewForSourceLead(
    {
      ...approveBody,
      operatorConfirmationText: LF2_PROOF_REVIEW_REJECT_CONFIRMATION,
    },
    db as never
  );
  assert.equal(rejected.ok, false);
  if (rejected.ok) return;
  assert.equal(rejected.error, "request_id_action_conflict");
});

test("negative invariants: approval does not create delivery attempts or mutate allocation", async () => {
  const db = makeDb();
  await approveLf2ProofReviewForSourceLead(approveBody, db as never);
  assert.equal(db._writes.includes("deliveryAttempt"), false);
  assert.equal(db._writes.includes("leadAllocation"), false);
  assert.equal(db._writes.includes("leadOrder"), false);
});
