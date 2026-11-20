import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import Fastify, { type FastifyInstance } from "fastify";
import { signStaffAssertion, STAFF_ASSERTION_HEADER } from "@sa360/shared/staff-assertion";

import { prisma } from "../../lib/db.js";
import { adminClientCampaignGhlExecutionRoutes } from "../../routes/admin-client-campaign-ghl-execution.js";
import { SA360_REQUIRED_GHL_CUSTOM_FIELD_KEYS } from "../ghl-config-discovery/ghl-config-discovery.types.js";
import { campaignGhlConfigurationHash, frozenScopeFromShadow } from "./campaign-ghl-frozen-shadow.js";
import { issueCampaignGhlExecutionGrant } from "./campaign-ghl-execution-grant.js";
import {
  claimCampaignGhlOperation,
  isExternalCompletion,
  listCampaignReceipts,
  recordCampaignGhlOutcome,
  recordSimulatedCampaignGhlOperation,
} from "./campaign-ghl-execution-receipt.js";
import { prepareCampaignGhlDelivery } from "./prepare-campaign-ghl-delivery.js";
import type { WorkflowDiscoveryEvidence } from "./campaign-ghl-workflow-verification.js";

const ADMIN_KEY = "campaign-ghl-execution-foundation-key";
const SECRET = "campaign-ghl-staff-assertion-secret";
const LOCATION = "loc-shared-e1b";
const ON = {
  SA360_CLIENT_CAMPAIGN_GHL_EXECUTION_ENABLED: "true",
  ADMIN_API_KEY: ADMIN_KEY,
  SA360_STAFF_ASSERTION_SECRET: SECRET,
} as NodeJS.ProcessEnv;
const STAFF = "c0123456789abcdefghijklmn";

const clientIds: string[] = [];
const eventIds: string[] = [];
let app: FastifyInstance;
let evidenceReads = 0;
let seq = 0;

describe("campaign GHL execution foundation", { concurrency: 1 }, () => {
  before(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    delete process.env.SA360_ADMIN_KEY;
    app = Fastify({ logger: false });
    await app.register(adminClientCampaignGhlExecutionRoutes, {
      prefix: "/admin/v1",
      env: ON,
      readEvidence: async () => {
        evidenceReads += 1;
        return publishedEvidence();
      },
    });
  });

  after(async () => {
    await app.close();
    if (eventIds.length > 0) {
      await prisma.campaignGhlExecutionReceipt.deleteMany({ where: { sourceLeadEventId: { in: eventIds } } });
      await prisma.campaignGhlExecutionGrant.deleteMany({ where: { sourceLeadEventId: { in: eventIds } } });
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "ClientCampaignShadowDecision" DISABLE TRIGGER "ClientCampaignShadowDecision_immutable_guard"`
      );
      await prisma.clientCampaignShadowDecision.deleteMany({ where: { sourceLeadEventId: { in: eventIds } } });
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "ClientCampaignShadowDecision" ENABLE TRIGGER "ClientCampaignShadowDecision_immutable_guard"`
      );
      await prisma.sourceLeadEvent.deleteMany({ where: { id: { in: eventIds } } });
    }
    if (clientIds.length > 0) {
      await prisma.clientGhlDestination.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await prisma.clientCampaign.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    }
    delete process.env.ADMIN_API_KEY;
  });

  test("authorized staff can grant one frozen lane, and other lanes stay unauthorized", async () => {
    const clientAccountId = await createClient("lanes");
    const otherClientId = await createClient("other");
    const east = await seedLane(clientAccountId, "vet-east", "VET", "wf-a", ["SA360::NICHE::NURSE"]);
    const west = await seedLane(clientAccountId, "vet-west", "VET", "wf-b", ["SA360::CAMPAIGN::vet-east"]);
    const nurse = await seedLane(clientAccountId, "nurse-life", "NURSE", "wf-c", []);
    const sheetsBefore = await prisma.companySheetsDeliveryJob.count({ where: { clientAccountId } });
    const liveBefore = await prisma.ghlLiveDeliveryRun.count({ where: { destinationClientAccountId: clientAccountId } });
    const rulesBefore = await prisma.campaignRoutingRule.count({ where: { clientAccountId } });

    const issued = await issueFor(clientAccountId, east);
    assert.equal(issued.ok, true, issued.error ?? "");
    assert.equal(issued.executionStarted, false);
    assert.equal(issued.externalCall, false);
    const shadow = await prisma.clientCampaignShadowDecision.findUniqueOrThrow({
      where: { sourceLeadEventId_decisionVersion: { sourceLeadEventId: east.eventId, decisionVersion: 1 } },
    });
    assert.equal((shadow.proposedTagsJson as { executionAuthorized?: boolean }).executionAuthorized, false);

    const browser = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${clientAccountId}/campaign-ghl-grants`,
      headers: { "x-sa360-admin-key": ADMIN_KEY, "x-sa360-admin-actor": "Browser Admin" },
      payload: grantBody(east, randomUUID()),
    });
    assert.equal(browser.statusCode, 200);
    assert.equal(browser.json().replayed, true);
    const stored = await prisma.campaignGhlExecutionGrant.findUniqueOrThrow({ where: { id: issued.grantId! } });
    assert.equal(stored.authorizedByActor, "ADMIN");

    const denied = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${clientAccountId}/campaign-ghl-grants`,
      headers: {
        "x-sa360-admin-key": ADMIN_KEY,
        [STAFF_ASSERTION_HEADER]: signStaffAssertion({ staffPrincipalId: STAFF, secret: SECRET }).token,
      },
      payload: grantBody(west, randomUUID()),
    });
    assert.equal(denied.statusCode, 403);
    assert.equal(await prisma.campaignGhlExecutionGrant.count({ where: { clientCampaignId: west.campaignId } }), 0);

    const bogus = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${clientAccountId}/campaign-ghl-grants`,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
      payload: { ...grantBody(east, randomUUID()), granted: true, workflowLiveVerified: true },
    });
    assert.equal(bogus.statusCode, 400);

    const wrongWorkflow = await issueFor(clientAccountId, { ...east, workflowId: "wf-other" });
    assert.equal(wrongWorkflow.ok, false);
    assert.equal(wrongWorkflow.error, "workflow_mismatch");
    const wrongRevision = await issueFor(clientAccountId, { ...west, revision: west.revision + 1 });
    assert.equal(wrongRevision.error, "frozen_revision_mismatch");
    const missingShadow = await issueCampaignGhlExecutionGrant(
      prisma,
      {
        requestId: randomUUID(),
        clientAccountId,
        sourceLeadEventId: east.eventId,
        clientCampaignId: east.campaignId,
        expectedDecisionVersion: 1,
        expectedCampaignRevision: east.revision,
        expectedWorkflowId: "wf-a",
        expectedLocationId: LOCATION,
        expiresAt: null,
      },
      "ADMIN"
    );
    assert.equal(missingShadow.ok, true);

    const noShadowEvent = await eventOnly(clientAccountId);
    const noShadow = await issueCampaignGhlExecutionGrant(
      prisma,
      {
        requestId: randomUUID(),
        clientAccountId,
        sourceLeadEventId: noShadowEvent,
        clientCampaignId: east.campaignId,
        expectedDecisionVersion: 1,
        expectedCampaignRevision: east.revision,
        expectedWorkflowId: "wf-a",
        expectedLocationId: LOCATION,
        expiresAt: null,
      },
      "ADMIN"
    );
    assert.equal(noShadow.error, "missing_shadow_row");

    const [first, second] = await Promise.all([
      issueFor(clientAccountId, nurse, "44444444-4444-4444-8444-444444444444"),
      issueFor(clientAccountId, nurse, "44444444-4444-4444-8444-444444444444"),
    ]);
    assert.equal(first.ok && second.ok, true);
    assert.equal(first.grantId, second.grantId);
    assert.equal(await prisma.campaignGhlExecutionGrant.count({ where: { clientCampaignId: nurse.campaignId } }), 1);

    const eastPlan = await prepareCampaignGhlDelivery(prisma, {
      clientAccountId,
      sourceLeadEventId: east.eventId,
      env: ON,
      readEvidence: async () => publishedEvidence(),
    });
    const westPlan = await prepareCampaignGhlDelivery(prisma, {
      clientAccountId,
      sourceLeadEventId: west.eventId,
      env: ON,
      readEvidence: async () => publishedEvidence(),
    });
    const nursePlan = await prepareCampaignGhlDelivery(prisma, {
      clientAccountId,
      sourceLeadEventId: nurse.eventId,
      env: ON,
      readEvidence: async () => publishedEvidence(),
    });
    assert.equal(eastPlan.grantState, "active");
    assert.equal(westPlan.grantState, "absent");
    assert.equal(nursePlan.grantState, "active");
    assert.equal(eastPlan.plan.frozen?.workflowIdGhl, "wf-a");
    assert.equal(westPlan.plan.frozen?.workflowIdGhl, "wf-b");
    assert.equal(nursePlan.plan.frozen?.workflowIdGhl, "wf-c");
    assert.notEqual(eastPlan.plan.frozen?.clientCampaignId, westPlan.plan.frozen?.clientCampaignId);
    assert.equal(eastPlan.plan.attribution.contactTagsUsedForSelection, false);
    assert.equal(eastPlan.plan.frozen?.clientCampaignId, east.campaignId);
    assert.equal(eastPlan.plan.tags.postAuthorized, false);
    assert.equal(eastPlan.plan.tags.posting, "withheld_unknown");
    assert.equal(eastPlan.plan.liveExternalCallAuthorized, false);
    assert.equal(eastPlan.plan.sheetsWriterInvoked, false);
    assert.equal(eastPlan.externalHttpAttempted, false);
    assert.equal(JSON.stringify(eastPlan.plan).includes("sheet-should-not-matter"), false);

    const crossed = await prepareCampaignGhlDelivery(prisma, {
      clientAccountId: otherClientId,
      sourceLeadEventId: east.eventId,
      env: ON,
      readEvidence: async () => {
        throw new Error("cross-client discovery");
      },
    });
    assert.equal(crossed.plan.frozen?.clientCampaignId ?? null, null);
    assert.equal(JSON.stringify(crossed.plan).includes("wf-a"), false);
    assert.equal(crossed.plan.liveExternalCallAuthorized, false);

    const offReads = evidenceReads;
    const legacy = await prepareCampaignGhlDelivery(prisma, {
      clientAccountId,
      sourceLeadEventId: east.eventId,
      env: { ADMIN_API_KEY: ADMIN_KEY },
      readEvidence: async () => {
        throw new Error("flag off must not discover");
      },
    });
    assert.equal(legacy.plan.disposition, "legacy_unchanged");
    assert.equal(legacy.plan.reasonCodes.includes("campaign_ghl_execution_gate_off"), true);
    assert.equal(evidenceReads, offReads);
    assert.equal(await prisma.companySheetsDeliveryJob.count({ where: { clientAccountId } }), sheetsBefore);
    assert.equal(await prisma.ghlLiveDeliveryRun.count({ where: { destinationClientAccountId: clientAccountId } }), liveBefore);
    assert.equal(await prisma.campaignRoutingRule.count({ where: { clientAccountId } }), rulesBefore);

    const prepared = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${clientAccountId}/campaign-ghl-preparation`,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
      payload: { sourceLeadEventId: east.eventId, granted: true, workflowLiveVerified: true },
    });
    assert.equal(prepared.statusCode, 400);

    const off = Fastify({ logger: false });
    await off.register(adminClientCampaignGhlExecutionRoutes, {
      prefix: "/admin/v1",
      env: { ADMIN_API_KEY: ADMIN_KEY },
    });
    const disabled = await off.inject({
      method: "POST",
      url: `/admin/v1/clients/${clientAccountId}/campaign-ghl-preparation`,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
      payload: { sourceLeadEventId: east.eventId },
    });
    await off.close();
    assert.equal(disabled.statusCode, 404);
    assert.equal(disabled.json().executionStarted, false);
    assert.equal(disabled.json().externalCall, false);
  });

  test("expired, revoked, stale, and collision evidence fail closed without a GHL write", async () => {
    const clientAccountId = await createClient("gates");
    const lane = await seedLane(clientAccountId, "vet-east", "VET", "wf-a", []);
    const expiresAt = new Date(Date.now() + 60_000);
    const issued = await issueFor(clientAccountId, lane, randomUUID(), expiresAt);
    assert.equal(issued.ok, true, issued.error ?? "");
    const expired = await prepareCampaignGhlDelivery(prisma, {
      clientAccountId,
      sourceLeadEventId: lane.eventId,
      env: ON,
      now: new Date(expiresAt.getTime() + 1000),
      readEvidence: async () => publishedEvidence(),
    });
    assert.equal(expired.grantState, "expired");
    assert.equal(expired.plan.reasonCodes.includes("execution_grant_expired"), true);
    assert.equal(expired.plan.selectedWorkflowIdGhl, null);

    const revoked = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${clientAccountId}/campaign-ghl-grants/${issued.grantId}/revoke`,
      headers: { "x-sa360-admin-key": ADMIN_KEY, "x-sa360-admin-actor": "Browser Admin" },
      payload: { reason: "operator stop" },
    });
    assert.equal(revoked.statusCode, 200);
    const afterRevoke = await prepareCampaignGhlDelivery(prisma, {
      clientAccountId,
      sourceLeadEventId: lane.eventId,
      env: ON,
      readEvidence: async () => publishedEvidence(),
    });
    assert.equal(afterRevoke.grantState, "revoked");
    assert.equal(afterRevoke.plan.reasonCodes.includes("execution_grant_revoked"), true);

    const fresh = await seedLane(clientAccountId, "vet-west", "VET", "wf-b", []);
    const active = await issueFor(clientAccountId, fresh);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "CampaignGhlExecutionGrant" DISABLE TRIGGER "CampaignGhlExecutionGrant_guard"`
    );
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "CampaignGhlExecutionGrant" SET "workflowIdGhl" = 'wf-stale' WHERE id = $1`,
        active.grantId
      );
    } finally {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "CampaignGhlExecutionGrant" ENABLE TRIGGER "CampaignGhlExecutionGrant_guard"`
      );
    }
    const stale = await prepareCampaignGhlDelivery(prisma, {
      clientAccountId,
      sourceLeadEventId: fresh.eventId,
      env: ON,
      readEvidence: async () => publishedEvidence(),
    });
    assert.equal(stale.grantState, "stale");
    assert.equal(stale.plan.reasonCodes.includes("execution_grant_stale"), true);

    const unknown = await prepareCampaignGhlDelivery(prisma, {
      clientAccountId,
      sourceLeadEventId: fresh.eventId,
      env: ON,
      readEvidence: async () => ({
        ...publishedEvidence(),
        workflows: [{ id: "wf-b", status: null, locationId: LOCATION, triggers: null }],
      }),
    });
    assert.equal(unknown.verification?.workflowEligible, "unknown");
    assert.equal(unknown.plan.reasonCodes.includes("workflow_status_unknown"), true);
    assert.equal(unknown.plan.selectedWorkflowIdGhl, null);

    const missingFields = await prepareCampaignGhlDelivery(prisma, {
      clientAccountId,
      sourceLeadEventId: fresh.eventId,
      env: ON,
      readEvidence: async () => ({ ...publishedEvidence(), customFieldKeys: [] }),
    });
    assert.equal(missingFields.verification?.requiredCustomFieldsInstalled, "false");
    assert.equal(missingFields.plan.reasonCodes.includes("required_custom_fields_missing"), true);

    const collision = await prepareCampaignGhlDelivery(prisma, {
      clientAccountId,
      sourceLeadEventId: fresh.eventId,
      env: ON,
      readEvidence: async () => ({
        ...publishedEvidence(),
        triggerInspectionComplete: true,
        workflows: [
          {
            id: "wf-b",
            status: "published",
            locationId: LOCATION,
            triggers: [{ type: "contact_tag", filters: ["SA360::NICHE::VET", "SA360::TRIGGER::NEW_LEAD"] }],
          },
        ],
      }),
    });
    assert.equal(collision.verification?.tagTriggerCollision, "CONFLICT");
    assert.equal(collision.verification?.directApiEnrollmentEliminatesCollisions, false);
    assert.equal(collision.plan.tags.proposal, null);
    assert.equal(collision.plan.tags.posting, "withheld_conflict");
    assert.equal(collision.plan.tags.postAuthorized, false);
    assert.equal(collision.plan.tags.removesExistingNicheOrCampaignTags, false);
    assert.equal(collision.externalHttpAttempted, false);
  });

  test("claims are single-owner, ambiguous results hold, and simulated rows are not completions", async () => {
    const clientAccountId = await createClient("ledger");
    const lane = await seedLane(clientAccountId, "vet-east", "VET", "wf-a", []);
    const scope = {
      sourceLeadEventId: lane.eventId,
      clientAccountId,
      clientCampaignId: lane.campaignId,
      decisionVersion: 1,
      ghlLocationId: LOCATION,
      workflowIdGhl: "wf-a",
    };
    const [left, right] = await Promise.all([
      claimCampaignGhlOperation(prisma, scope, "workflow"),
      claimCampaignGhlOperation(prisma, scope, "workflow"),
    ]);
    assert.equal(left.externalSendAuthorized, false);
    assert.equal(right.externalSendAuthorized, false);
    assert.equal(Number(left.claimOwner) + Number(right.claimOwner), 1);
    assert.equal(await prisma.campaignGhlExecutionReceipt.count({ where: { ...scope, operation: "workflow" } }), 1);

    const owner = left.claimOwner ? left : right;
    const ambiguous = await recordCampaignGhlOutcome(prisma, {
      receiptId: owner.receiptId,
      outcome: "ambiguous",
      httpStatus: 0,
    });
    assert.equal(ambiguous.ok, true);
    const again = await claimCampaignGhlOperation(prisma, scope, "workflow");
    assert.equal(again.claimOwner, false);
    assert.equal(again.externalSendAuthorized, false);
    const held = await prepareCampaignGhlDelivery(prisma, {
      clientAccountId,
      sourceLeadEventId: lane.eventId,
      env: ON,
      readEvidence: async () => publishedEvidence(),
    });
    const workflow = held.plan.operations.find((operation) => operation.operation === "workflow");
    assert.equal(workflow?.existingPolicy, "hold_ambiguous");
    assert.equal(workflow?.externalCallAuthorized, false);
    assert.equal(held.plan.disposition === "simulated_ready", false);

    const opportunity = await claimCampaignGhlOperation(prisma, scope, "opportunity");
    assert.equal(opportunity.claimOwner, true);
    const completed = await recordCampaignGhlOutcome(prisma, {
      receiptId: opportunity.receiptId,
      outcome: "completed",
      httpStatus: 200,
      externalId: "opp-1",
    });
    assert.equal(completed.ok, true);
    if (completed.ok) assert.equal(completed.externalCompletion, true);
    const repeat = await claimCampaignGhlOperation(prisma, scope, "opportunity");
    assert.equal(repeat.claimOwner, false);
    const suppressed = await prepareCampaignGhlDelivery(prisma, {
      clientAccountId,
      sourceLeadEventId: lane.eventId,
      env: ON,
      readEvidence: async () => publishedEvidence(),
    });
    assert.equal(
      suppressed.plan.operations.find((operation) => operation.operation === "opportunity")?.existingPolicy,
      "skip_completed"
    );

    const simulated = await recordSimulatedCampaignGhlOperation(prisma, scope, "first_touch");
    assert.equal(simulated.ok, true);
    if (simulated.ok) assert.equal(simulated.externalCompletion, false);
    const rows = await listCampaignReceipts(prisma, scope);
    const firstTouch = rows.find((row) => row.operation === "first_touch");
    assert.equal(isExternalCompletion(firstTouch ?? null), false);
    assert.equal(firstTouch?.simulated, true);
    const withoutClaim = await recordCampaignGhlOutcome(prisma, {
      receiptId: firstTouch!.id,
      outcome: "completed",
      httpStatus: 200,
    });
    assert.equal(withoutClaim.ok, false);
  });

  test("unresolved and conflicted shadows cannot be granted, even with a retained campaign id", async () => {
    const clientAccountId = await createClient("eligibility");
    const matched = await seedLane(clientAccountId, "vet-east", "VET", "wf-a", []);
    const missing = await seedLane(clientAccountId, "vet-west", "VET", "wf-b", [], {
      nicheClassificationStatus: "MISSING",
      reasonCodes: ["incoming_niche_missing"],
    });
    const review = await seedLane(clientAccountId, "vet-review", "VET", "wf-review", [], {
      status: "REVIEW_REQUIRED",
    });
    const conflict = await seedLane(clientAccountId, "nurse-conflict", "NURSE", "wf-c", [], {
      status: "REVIEW_REQUIRED",
      nicheClassificationStatus: "CONFLICT",
      reasonCodes: ["niche_classification_conflict"],
    });
    const unresolved = await seedLane(clientAccountId, "vet-open", "VET", "wf-open", [], {
      status: "UNRESOLVED",
      nicheClassificationStatus: "UNRESOLVED",
    });
    const crossed = await seedLane(clientAccountId, "vet-cross", "VET", "wf-cross", [], {
      status: "REVIEW_REQUIRED",
      reasonCodes: ["cross_client_identity_conflict"],
    });
    const unmatched = await seedLane(clientAccountId, "vet-route", "VET", "wf-route", [], {
      routingMatched: false,
    });

    const issued = await issueFor(clientAccountId, matched);
    const missingGrant = await issueFor(clientAccountId, missing);
    assert.equal(issued.ok, true, issued.error ?? "");
    assert.equal(missingGrant.ok, true, missingGrant.error ?? "");
    assert.equal(issued.executionStarted, false);
    assert.equal(issued.externalCall, false);

    for (const [lane, error] of [
      [review, "shadow_review_required"],
      [conflict, "niche_conflict"],
      [unresolved, "shadow_unresolved"],
      [crossed, "source_ownership_conflict"],
      [unmatched, "authoritative_client_invalid"],
    ] as const) {
      const denied = await issueFor(clientAccountId, lane);
      assert.equal(denied.ok, false, lane.slug);
      assert.equal(denied.error, error, lane.slug);
      assert.equal(denied.executionStarted, false);
      assert.equal(denied.externalCall, false);
      assert.equal(await prisma.campaignGhlExecutionGrant.count({ where: { sourceLeadEventId: lane.eventId } }), 0);
    }

    const shadow = await prisma.clientCampaignShadowDecision.findUniqueOrThrow({
      where: { sourceLeadEventId_decisionVersion: { sourceLeadEventId: conflict.eventId, decisionVersion: 1 } },
    });
    const scope = frozenScopeFromShadow(shadow, conflict.eventId);
    assert.ok(scope);
    assert.equal(shadow.clientCampaignId, conflict.campaignId);
    const planted = await prisma.campaignGhlExecutionGrant.create({
      data: {
        requestId: randomUUID(),
        payloadHash: "planted-invalid-grant",
        sourceLeadEventId: conflict.eventId,
        shadowDecisionId: shadow.id,
        clientAccountId,
        clientCampaignId: conflict.campaignId,
        decisionVersion: 1,
        campaignRevision: scope.campaignRevision,
        ghlLocationId: scope.ghlLocationId,
        workflowIdGhl: scope.workflowIdGhl,
        configurationHash: campaignGhlConfigurationHash(scope),
        status: "active",
        authorizedByActor: "ADMIN",
      },
    });
    const prepared = await prepareCampaignGhlDelivery(prisma, {
      clientAccountId,
      sourceLeadEventId: conflict.eventId,
      env: ON,
      readEvidence: async () => {
        throw new Error("ineligible shadow must not discover");
      },
    });
    assert.equal(prepared.grantState, "stale");
    assert.equal(prepared.grantId, planted.id);
    assert.equal(prepared.plan.reasonCodes.includes("execution_grant_stale"), true);
    assert.equal(prepared.plan.selectedWorkflowIdGhl, null);
    assert.equal(prepared.plan.liveExternalCallAuthorized, false);
    assert.equal(prepared.externalHttpAttempted, false);
    assert.equal(await prisma.campaignGhlExecutionReceipt.count({ where: { sourceLeadEventId: conflict.eventId } }), 0);

    const revoked = await prisma.campaignGhlExecutionGrant.update({
      where: { id: planted.id },
      data: { status: "revoked", revokedAt: new Date(), revokedByActor: "ADMIN", revocationReason: "invalid shadow" },
    });
    assert.equal(revoked.status, "revoked");
    const after = await prepareCampaignGhlDelivery(prisma, {
      clientAccountId,
      sourceLeadEventId: conflict.eventId,
      env: ON,
      readEvidence: async () => publishedEvidence(),
    });
    assert.equal(after.grantState, "revoked");
    assert.equal(after.plan.liveExternalCallAuthorized, false);
  });
});

type Lane = {
  eventId: string;
  campaignId: string;
  revision: number;
  workflowId: string;
  slug: string;
};

async function createClient(label: string): Promise<string> {
  seq += 1;
  const clientAccountId = `e1b${label}${seq}${Date.now().toString(36)}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  await prisma.clientAccount.create({
    data: { clientAccountId, clientDisplayName: label, status: "onboarding" },
  });
  await prisma.clientGhlDestination.create({
    data: {
      clientAccountId,
      destinationSubaccountIdGhl: LOCATION,
      deliveryEnabled: true,
      deliveryMode: "live",
      clientCutoverApproved: true,
      internalApprovalStatus: "approved",
      workflowTriggerMode: "direct_api",
      requiredFieldsInstalled: true,
    },
  });
  clientIds.push(clientAccountId);
  return clientAccountId;
}

async function seedLane(
  clientAccountId: string,
  slug: string,
  nicheKey: string,
  workflowId: string,
  tags: string[],
  shadow: {
    status?: "MATCHED" | "UNRESOLVED" | "REVIEW_REQUIRED";
    nicheClassificationStatus?: "MATCH" | "MISSING" | "CONFLICT" | "UNRESOLVED";
    reasonCodes?: string[];
    reviewCandidateCampaignIds?: string[];
    routingMatched?: boolean;
  } = {}
): Promise<Lane> {
  const campaign = await prisma.clientCampaign.create({
    data: {
      clientAccountId,
      slug,
      displayName: slug,
      nicheKey,
      productType: "life_insurance",
      status: "ready",
      revision: 3,
      createdByActor: "ADMIN",
      updatedByActor: "ADMIN",
    },
  });
  const event = await prisma.sourceLeadEvent.create({
    data: {
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceType: "webhook",
      sourceRouteKey: `LCIO_NG_${slug}_${seq}`,
      clientAccountIdResolved: clientAccountId,
      status: "routing_matched",
      rawPayloadJson: { tags, funnel_id: slug },
      normalizedPayloadJson: {
        fullName: "Ada Lead",
        phone: "+15555550123",
        email: "ada@example.com",
        tags,
      },
      routingResultJson: {
        matched: shadow.routingMatched !== false,
        routingAuthority: "confirmed_source_association",
      },
    },
  });
  eventIds.push(event.id);
  await prisma.clientCampaignShadowDecision.create({
    data: {
      sourceLeadEventId: event.id,
      decisionVersion: 1,
      status: shadow.status ?? "MATCHED",
      clientAccountId,
      clientCampaignId: campaign.id,
      campaignRevision: 3,
      campaignSlug: slug,
      campaignDisplayName: slug,
      campaignStatus: "ready",
      configuredNicheKey: nicheKey,
      configuredProductType: "life_insurance",
      winningRoutingAuthority: "confirmed_source_association",
      matchedBindingIds: [],
      reviewCandidateCampaignIds: shadow.reviewCandidateCampaignIds ?? [],
      reasonCodes: shadow.reasonCodes ?? [],
      sourceEvidenceJson: [],
      incomingNicheJson: { trustedProvenance: "none" },
      nicheClassificationStatus: shadow.nicheClassificationStatus ?? "MATCH",
      leadTypeDecisionJson: { absent: true },
      proposedTagsJson: {
        authorized: false,
        executionAuthorized: false,
        nicheTag: `SA360::NICHE::${nicheKey}`,
        campaignTag: `SA360::CAMPAIGN::${slug}`,
        deliveryExecuted: false,
      },
      destinationSelectionJson: {
        informationalOnly: true,
        deliveryExecuted: false,
        workflowIdGhl: workflowId,
        workflowTriggerMode: "direct_api",
        ghlLocationId: LOCATION,
        spreadsheetId: "sheet-should-not-matter",
        worksheetId: 4,
        worksheetTitle: slug,
        workflowLiveVerified: false,
        mapPublished: false,
      },
    },
  });
  return { eventId: event.id, campaignId: campaign.id, revision: 3, workflowId, slug };
}

async function eventOnly(clientAccountId: string): Promise<string> {
  const event = await prisma.sourceLeadEvent.create({
    data: {
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceType: "webhook",
      clientAccountIdResolved: clientAccountId,
      status: "routing_matched",
      rawPayloadJson: { tags: ["SA360::NICHE::NURSE"] },
      routingResultJson: { matched: true },
    },
  });
  eventIds.push(event.id);
  return event.id;
}

function issueFor(clientAccountId: string, lane: Lane, requestId = randomUUID(), expiresAt: Date | null = null) {
  return issueCampaignGhlExecutionGrant(
    prisma,
    {
      requestId,
      clientAccountId,
      sourceLeadEventId: lane.eventId,
      clientCampaignId: lane.campaignId,
      expectedDecisionVersion: 1,
      expectedCampaignRevision: lane.revision,
      expectedWorkflowId: lane.workflowId,
      expectedLocationId: LOCATION,
      expiresAt,
    },
    "ADMIN"
  );
}

function grantBody(lane: Lane, requestId: string) {
  return {
    requestId,
    sourceLeadEventId: lane.eventId,
    clientCampaignId: lane.campaignId,
    expectedDecisionVersion: 1,
    expectedCampaignRevision: lane.revision,
    expectedWorkflowId: lane.workflowId,
    expectedLocationId: LOCATION,
    expiresAt: null,
  };
}

function publishedEvidence(): WorkflowDiscoveryEvidence {
  return {
    snapshotVerification: "live",
    triggerInspectionComplete: false,
    workflows: ["wf-a", "wf-b", "wf-c"].map((id) => ({
      id,
      status: "published",
      locationId: LOCATION,
      triggers: null,
    })),
    customFieldKeys: [...SA360_REQUIRED_GHL_CUSTOM_FIELD_KEYS],
    readError: false,
  };
}
