import assert from "node:assert/strict";
import { after, test } from "node:test";
import { PrismaClient, type Prisma } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { ghlSnapshotOutcomeMarker } from "../../lib/ghl-config-snapshot-validity.js";
import { LIVE_CANARY_CONFIRMATION_TEXT } from "../../lib/ghl-delivery-adapter-mode.js";
import { lockGhlLocationSnapshot } from "../../repositories/ghl-location-config-snapshot.repository.js";
import { CLIENT_CHANNEL_EXPECTED_CUSTOM_FIELDS } from "../client-channel-profile/client-channel-profile.constants.js";
import { validateClientChannelProfileReadiness } from "../client-channel-profile/client-channel-profile-readiness.service.js";
import { executeLiveCanaryForPlan } from "../ghl-delivery-adapter/ghl-live-canary.service.js";
import { evaluateLiveCanaryPreflight } from "../ghl-delivery-adapter/ghl-live-canary-gates.service.js";
import { LAL_AI_BOT1_VET_WEBFORM_WORKFLOW_NAME } from "../ghl-delivery-adapter/lal-ai-bot1-vet-snapshot.js";
import type { LeadDeliveryPlan } from "@prisma/client";
import { getClientDeliveryConfigSummary, saveClientGhlConfig } from "./client-ghl-config.service.js";
import { getRoutingRuleGhlConfigSummary, saveRoutingRuleGhlConfig } from "./routing-rule-ghl-config.service.js";

const clientIds: string[] = [];
const locationIds: string[] = [];
let seq = 0;

after(async () => {
  if (locationIds.length > 0) {
    await prisma.ghlLocationConfigSnapshot.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.ghlLocationConnection.deleteMany({ where: { locationId: { in: locationIds } } });
  }
  if (clientIds.length > 0) {
    await prisma.leadDeliveryPlan.deleteMany({ where: { destinationClientAccountId: { in: clientIds } } });
    await prisma.ghlLiveDeliveryRun.deleteMany({ where: { destinationClientAccountId: { in: clientIds } } });
    await prisma.campaignRoutingRule.deleteMany({ where: { clientAccountId: { in: clientIds } } });
    await prisma.clientGhlDestination.deleteMany({ where: { clientAccountId: { in: clientIds } } });
    await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } });
  }
});

test("Invalid JWT after a complete snapshot does not change a live destination or routing rule", async () => {
  const world = await seedWorld({ live: true });
  await insertSnapshot(world.locationId, completeSnapshot(world.locationId));
  await insertSnapshot(world.locationId, failedSnapshot(world.locationId, "authentication"));
  const before = await operationalImage(world);
  const saved = await saveClientGhlConfig(world.clientAccountId, retargetBody(world.locationId));
  const routed = await saveRoutingRuleGhlConfig(world.ruleId, retargetBody(world.locationId));
  assert.equal("error" in saved && saved.code, "SNAPSHOT_NOT_CURRENT");
  assert.match("error" in saved ? saved.error : "", /Reconnect the location/);
  assert.equal("error" in routed && routed.code, "SNAPSHOT_NOT_CURRENT");
  assert.deepEqual(await operationalImage(world), before);
  await assertNoDeliverySideEffects(world.clientAccountId);
});

test("a network timeout after a complete snapshot rejects the save and preserves mappings", async () => {
  const world = await seedWorld({ live: true });
  await insertSnapshot(world.locationId, completeSnapshot(world.locationId));
  await insertSnapshot(world.locationId, failedSnapshot(world.locationId, "timeout"));
  const before = await operationalImage(world);
  const saved = await saveClientGhlConfig(world.clientAccountId, retargetBody(world.locationId));
  assert.equal("error" in saved && saved.code, "SNAPSHOT_NOT_CURRENT");
  assert.match("error" in saved ? saved.error : "", /did not complete/);
  assert.deepEqual(await operationalImage(world), before);
});

test("a partial workflow failure cannot retarget a workflow or owner", async () => {
  const world = await seedWorld({ live: true });
  await insertSnapshot(world.locationId, completeSnapshot(world.locationId));
  await insertSnapshot(world.locationId, failedSnapshot(world.locationId, "partial_failure"));
  const before = await operationalImage(world);
  const saved = await saveClientGhlConfig(world.clientAccountId, retargetBody(world.locationId));
  assert.equal("error" in saved && saved.code, "SNAPSHOT_NOT_CURRENT");
  const after = await operationalImage(world);
  assert.deepEqual(after, before);
  assert.equal(after.destination.destinationWorkflowIdGhl, "wf_saved");
  assert.equal(after.destination.defaultAssignedUserIdGhl, null);
  assert.equal(after.rule.destinationWorkflowIdGhl, "wf_saved");
});

test("a failed refresh with no prior snapshot rejects the save", async () => {
  const world = await seedWorld({ live: true });
  await insertSnapshot(world.locationId, failedSnapshot(world.locationId, "provider_outage"));
  const before = await operationalImage(world);
  const saved = await saveClientGhlConfig(world.clientAccountId, retargetBody(world.locationId));
  assert.equal("error" in saved && saved.code, "SNAPSHOT_NOT_CURRENT");
  assert.deepEqual(await operationalImage(world), before);
});

test("a complete snapshot with an empty workflow list still allows a save and does not invent a workflow", async () => {
  const world = await seedWorld({ live: false });
  await insertSnapshot(world.locationId, {
    ...completeSnapshot(world.locationId),
    workflowsJson: [],
  });
  const saved = await saveClientGhlConfig(world.clientAccountId, { locationId: world.locationId });
  assert.equal("ghlDestination" in saved, true);
  const after = await operationalImage(world);
  assert.equal(after.destination.destinationWorkflowIdGhl, "wf_saved");
  assert.equal(after.destination.deliveryEnabled, false);
  assert.deepEqual(after.destination.sa360CustomFieldIdMapJson, {
    sa360_lead_uid: "field_keep",
    sa360_campaign_id: "field_campaign",
  });

  const retarget = await saveClientGhlConfig(world.clientAccountId, retargetBody(world.locationId));
  assert.equal("error" in retarget && retarget.code, "LAL_WEBFORM_NOT_FOUND");
  assert.equal((await operationalImage(world)).destination.destinationWorkflowIdGhl, "wf_saved");
});

test("a fresh complete snapshot allows an explicit save without changing delivery flags", async () => {
  const world = await seedWorld({ live: false });
  await insertSnapshot(world.locationId, completeSnapshot(world.locationId, "wf_explicit"));
  const saved = await saveClientGhlConfig(world.clientAccountId, {
    locationId: world.locationId,
    destinationWorkflowIdGhl: "wf_explicit",
  });
  assert.equal("ghlDestination" in saved, true);
  if (!("ghlDestination" in saved)) return;
  assert.equal(saved.ghlDestination.destinationWorkflowIdGhl, "wf_explicit");
  const after = await operationalImage(world);
  assert.equal(after.destination.destinationWorkflowIdGhl, "wf_explicit");
  assert.equal(after.destination.deliveryEnabled, false);
  assert.equal(after.destination.deliveryMode, "shadow");
  assert.equal(after.destination.clientCutoverApproved, false);
  assert.equal(after.destination.internalApprovalStatus, "not_reviewed");
  assert.equal(after.rule.deliveryEnabled, false);
  const routed = await saveRoutingRuleGhlConfig(world.ruleId, {
    locationId: world.locationId,
    destinationWorkflowIdGhl: "wf_explicit",
  });
  assert.equal("item" in routed, true);
  if ("item" in routed) assert.equal(routed.item.destinationWorkflowIdGhl, "wf_explicit");
  assert.equal((await operationalImage(world)).rule.deliveryEnabled, false);
  const summary = await getClientDeliveryConfigSummary(world.clientAccountId);
  assert.equal("discoverySummary" in summary, true);
  if (!("discoverySummary" in summary) || !summary.discoverySummary) return;
  assert.equal(summary.discoverySummary.snapshotCurrent, true);
  assert.equal(summary.discoverySummary.discoveryEvidence, "current");
});

test("an active delivery configuration stays active after a rejected save", async () => {
  const world = await seedWorld({ live: true });
  await insertSnapshot(world.locationId, completeSnapshot(world.locationId));
  await insertSnapshot(world.locationId, failedSnapshot(world.locationId, "network"));
  const saved = await saveRoutingRuleGhlConfig(world.ruleId, retargetBody(world.locationId));
  assert.equal("error" in saved && saved.code, "SNAPSHOT_NOT_CURRENT");
  const after = await operationalImage(world);
  assert.equal(after.destination.deliveryEnabled, true);
  assert.equal(after.destination.deliveryMode, "live");
  assert.equal(after.destination.clientCutoverApproved, true);
  assert.equal(after.destination.internalApprovalStatus, "approved");
  assert.equal(after.rule.deliveryEnabled, true);
  assert.equal(after.rule.readinessStatus, "ready_for_shadow");
  assert.deepEqual(after.destination.sa360CustomFieldIdMapJson, {
    sa360_lead_uid: "field_keep",
    sa360_campaign_id: "field_campaign",
  });
  await assertNoDeliverySideEffects(world.clientAccountId);
});

test("a wrong-location snapshot is not authorization for this location", async () => {
  const world = await seedWorld({ live: true });
  const other = `loc_other_${world.locationId}`;
  locationIds.push(other);
  await insertSnapshot(other, completeSnapshot(other, "wf_other"));
  const before = await operationalImage(world);
  const saved = await saveClientGhlConfig(world.clientAccountId, retargetBody(world.locationId));
  assert.equal("error" in saved && saved.code, "SNAPSHOT_MISSING");
  assert.deepEqual(await operationalImage(world), before);
});

test("an expired or future snapshot cannot authorize a save", async () => {
  const expired = await seedWorld({ live: true });
  await insertSnapshot(expired.locationId, {
    ...completeSnapshot(expired.locationId),
    fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
  });
  const expiredBefore = await operationalImage(expired);
  const expiredSave = await saveClientGhlConfig(expired.clientAccountId, {
    locationId: expired.locationId,
    destinationWorkflowIdGhl: "wf_explicit",
  });
  assert.equal("error" in expiredSave && expiredSave.code, "SNAPSHOT_EXPIRED");
  assert.deepEqual(await operationalImage(expired), expiredBefore);

  const future = await seedWorld({ live: true });
  await insertSnapshot(future.locationId, {
    ...completeSnapshot(future.locationId),
    fetchedAt: new Date(Date.now() + 10 * 60 * 1000),
  });
  const futureBefore = await operationalImage(future);
  const futureSave = await saveClientGhlConfig(future.clientAccountId, {
    locationId: future.locationId,
    destinationWorkflowIdGhl: "wf_explicit",
  });
  assert.equal("error" in futureSave && futureSave.code, "SNAPSHOT_FUTURE");
  assert.deepEqual(await operationalImage(future), futureBefore);
});

test("a failed snapshot inserted after the location lock rejects the save", async () => {
  const world = await seedWorld({ live: true });
  await insertSnapshot(world.locationId, completeSnapshot(world.locationId));
  const before = await operationalImage(world);
  const saved = await saveClientGhlConfig(world.clientAccountId, retargetBody(world.locationId), {
    afterLocationLock: async (tx) => {
      await tx.ghlLocationConfigSnapshot.create({
        data: failedSnapshot(world.locationId, "authentication"),
      });
    },
  });
  assert.equal("error" in saved && saved.code, "SNAPSHOT_NOT_CURRENT");
  assert.deepEqual(await operationalImage(world), before);
  assert.equal(await prisma.ghlLocationConfigSnapshot.count({ where: { locationId: world.locationId } }), 1);
});

test("a failed snapshot committed while a save waits does not change the destination", async () => {
  const world = await seedWorld({ live: true });
  await insertSnapshot(world.locationId, completeSnapshot(world.locationId));
  const before = await operationalImage(world);
  const databaseUrl = process.env.DATABASE_URL;
  assert.equal(typeof databaseUrl, "string");
  const other = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const locked = defer();
  const release = defer();
  const holder = other.$transaction(
    async (tx) => {
      await lockGhlLocationSnapshot(tx, world.locationId);
      locked.resolve();
      await release.promise;
      await tx.ghlLocationConfigSnapshot.create({
        data: failedSnapshot(world.locationId, "timeout"),
      });
    },
    { timeout: 20_000 }
  );
  try {
    await locked.promise;
    const savePromise = saveClientGhlConfig(world.clientAccountId, retargetBody(world.locationId));
    await new Promise((resolve) => setTimeout(resolve, 200));
    release.resolve();
    const saved = await savePromise;
    await holder;
    assert.equal("error" in saved && saved.code, "SNAPSHOT_NOT_CURRENT");
    assert.deepEqual(await operationalImage(world), before);
    assert.equal(await prisma.ghlLiveDeliveryRun.count({ where: { destinationClientAccountId: world.clientAccountId } }), 0);
  } finally {
    release.resolve();
    await holder.catch(() => undefined);
    await other.$disconnect();
  }
});

test("canary preflight does not treat a failed snapshot as missing fields and does not execute", async () => {
  const world = await seedWorld({ live: true });
  await insertSnapshot(world.locationId, completeSnapshot(world.locationId));
  await insertSnapshot(world.locationId, failedSnapshot(world.locationId, "authentication"));
  const before = await operationalImage(world);
  const plan = await prisma.leadDeliveryPlan.create({
    data: {
      masterClientAccountId: "ops_master",
      destinationClientAccountId: world.clientAccountId,
      destinationSubaccountIdGhl: world.locationId,
      sourceLeadUid: "lead_ops",
      sourceEmail: "ops@example.test",
      sourcePhoneE164: "+15555550111",
      status: "planned",
    },
    include: { steps: true },
  });
  const preflight = await evaluateLiveCanaryPreflight(plan);
  assert.equal(preflight.canExecute, false);
  assert.ok(preflight.blockers.some((item) => /not a finding that fields are missing/.test(item)));
  assert.equal(preflight.blockers.some((item) => item.includes("field_keep")), false);
  const executed = await executeLiveCanaryForPlan(plan.id, {
    confirmLiveDeliveryRisk: true,
    operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
  });
  assert.equal("blocked" in executed && executed.blocked, true);
  assert.deepEqual(await operationalImage(world), before);
  assert.equal(await prisma.ghlLiveDeliveryRun.count({ where: { leadDeliveryPlanId: plan.id } }), 0);
});

test("a fresh empty custom-field list is reported as missing fields, not as an unavailable discovery", async () => {
  const world = await seedWorld({ live: false });
  await insertSnapshot(world.locationId, {
    ...completeSnapshot(world.locationId),
    customFieldsJson: [],
  });
  const preflight = await evaluateLiveCanaryPreflight(canaryPlan(world));
  assert.equal(preflight.canExecute, false);
  assert.ok(preflight.blockers.some((item) => /separate from a failed refresh/.test(item) && item.includes("field_keep")));
  assert.equal(preflight.blockers.some((item) => /not a finding that fields are missing/.test(item)), false);
  await assertNoDeliverySideEffects(world.clientAccountId);
});

test("client-channel readiness does not report READY from a failed discovery", async () => {
  const world = await seedWorld({ live: true });
  await insertSnapshot(world.locationId, {
    ...completeSnapshot(world.locationId),
    customFieldsJson: CLIENT_CHANNEL_EXPECTED_CUSTOM_FIELDS.map((key) => ({
      id: `hist_${key}`,
      name: key,
      fieldKey: key,
      dataType: "TEXT",
    })),
  });
  await insertSnapshot(world.locationId, failedSnapshot(world.locationId, "authentication"));
  const readiness = await validateClientChannelProfileReadiness({
    clientAccountId: world.clientAccountId,
    subaccountIdGhl: world.locationId,
    fetchImpl: async () => {
      throw new Error("readiness must not require a live custom-value call to avoid READY");
    },
  });
  assert.notEqual(readiness.status, "READY");
  assert.equal(readiness.status, "BLOCKED");
  assert.equal(readiness.snapshotCurrent, false);
  assert.ok(readiness.installedFields.includes("sa360_client_blue_enabled"));
  assert.equal(readiness.missingFields.includes("sa360_client_blue_enabled"), false);
  assert.match(readiness.notes.join(" "), /not verified/);

  const summary = await getRoutingRuleGhlConfigSummary(world.ruleId);
  assert.equal("discoverySummary" in summary, true);
  if (!("discoverySummary" in summary) || !summary.discoverySummary) return;
  assert.equal(summary.discoverySummary.snapshotCurrent, false);
  assert.equal(summary.discoverySummary.discoveryEvidence, "historical");
  assert.deepEqual(summary.discoverySummary.missingRequiredFields, []);

  const onlyFailed = await seedWorld({ live: false });
  await insertSnapshot(onlyFailed.locationId, {
    ...failedSnapshot(onlyFailed.locationId, "timeout"),
    customFieldsJson: [],
  });
  const unknown = await validateClientChannelProfileReadiness({
    clientAccountId: onlyFailed.clientAccountId,
    subaccountIdGhl: onlyFailed.locationId,
    fetchImpl: async () => {
      throw new Error("no live read");
    },
  });
  assert.equal(unknown.status, "UNKNOWN");
  assert.deepEqual(unknown.missingFields, []);
  assert.deepEqual(unknown.installedFields, []);
  assert.equal(unknown.snapshotCurrent, false);
});

type World = { clientAccountId: string; locationId: string; ruleId: string };

async function seedWorld(input: { live: boolean }): Promise<World> {
  seq += 1;
  const clientAccountId = `opsnap${seq}${Date.now().toString(36)}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  const locationId = `locops${seq}${Date.now().toString(36)}`;
  clientIds.push(clientAccountId);
  locationIds.push(locationId);
  await prisma.clientAccount.create({
    data: {
      clientAccountId,
      clientDisplayName: "Operational snapshot",
      status: "onboarding",
      portalLoginEmail: `${clientAccountId}@portal.example`,
    },
  });
  await prisma.ghlLocationConnection.create({
    data: {
      clientAccountId,
      locationId,
      locationName: "Operational location",
      accessTokenEncrypted: "not-a-real-cipher",
      refreshTokenEncrypted: "not-a-real-cipher",
      tokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      connectionStatus: "connected",
    },
  });
  await prisma.clientGhlDestination.create({
    data: {
      clientAccountId,
      destinationSubaccountIdGhl: locationId,
      locationName: "Saved location",
      ghlConnectionStatus: "connected",
      snapshotInstalled: true,
      requiredFieldsInstalled: true,
      defaultAssignedUserIdGhl: null,
      destinationWorkflowIdGhl: "wf_saved",
      sa360CustomFieldIdMapJson: { sa360_lead_uid: "field_keep", sa360_campaign_id: "field_campaign" },
      deliveryMode: input.live ? "live" : "shadow",
      deliveryEnabled: input.live,
      clientCutoverApproved: input.live,
      internalApprovalStatus: input.live ? "approved" : "not_reviewed",
      workflowTriggerMode: "tag_trigger",
      opportunityCreationEnabled: true,
    },
  });
  const rule = await prisma.campaignRoutingRule.create({
    data: {
      masterClientAccountId: "ops_master",
      clientAccountId,
      destinationSubaccountIdGhl: locationId,
      destinationWorkflowIdGhl: "wf_saved",
      defaultAssignedUserIdGhl: null,
      deliveryEnabled: input.live,
      deliveryMode: input.live ? "live" : "shadow",
      clientCutoverApproved: input.live,
      internalApprovalStatus: input.live ? "approved" : "not_reviewed",
      readinessStatus: "ready_for_shadow",
      snapshotInstalled: true,
      requiredFieldsInstalled: true,
      ghlConnectionStatus: "connected",
      matchType: "campaign_id",
      campaignId: `camp_${locationId}`,
      active: true,
    },
  });
  return { clientAccountId, locationId, ruleId: rule.id };
}

function completeSnapshot(locationId: string, workflowId = "wf_saved"): Prisma.GhlLocationConfigSnapshotCreateInput {
  return {
    locationId,
    fetchedAt: new Date(Date.now() - 60_000),
    locationName: "Saved location",
    locationJson: { id: locationId, name: "Saved location", primaryUserId: "user_saved" },
    workflowsJson: [{ id: workflowId, name: "Saved workflow", status: "published" }],
    usersJson: [],
    customFieldsJson: [
      { id: "field_keep", name: "sa360_lead_uid", fieldKey: "contact.sa360_lead_uid", dataType: "TEXT" },
      { id: "field_campaign", name: "sa360_campaign_id", fieldKey: "contact.sa360_campaign_id", dataType: "TEXT" },
    ],
    errorsJson: [ghlSnapshotOutcomeMarker("complete")],
    warningsJson: [],
  };
}

function failedSnapshot(
  locationId: string,
  outcome: "authentication" | "timeout" | "partial_failure" | "provider_outage" | "network"
): Prisma.GhlLocationConfigSnapshotCreateInput {
  return {
    locationId,
    fetchedAt: new Date(),
    locationName: "Failed refresh",
    locationJson: { id: locationId, name: "Failed refresh", primaryUserId: "user_from_failed" },
    workflowsJson: [
      { id: "wf_from_failed", name: LAL_AI_BOT1_VET_WEBFORM_WORKFLOW_NAME, status: "published" },
    ],
    usersJson: [{ id: "user_from_failed", name: "Failed Owner", role: "owner" }],
    customFieldsJson: [
      { id: "field_from_failed", name: "sa360_lead_uid", fieldKey: "contact.sa360_lead_uid", dataType: "TEXT" },
    ],
    errorsJson: [ghlSnapshotOutcomeMarker(outcome), outcome === "authentication" ? "Invalid JWT" : "discovery failed"],
    warningsJson: [],
  };
}

async function insertSnapshot(locationId: string, data: Prisma.GhlLocationConfigSnapshotCreateInput) {
  await prisma.ghlLocationConfigSnapshot.create({ data: { ...data, locationId } });
}

function retargetBody(locationId: string) {
  return { locationId, applyLalAiBot1WebformConfiguration: true as const };
}

async function operationalImage(world: World) {
  const destination = await prisma.clientGhlDestination.findUniqueOrThrow({
    where: { clientAccountId: world.clientAccountId },
  });
  const rule = await prisma.campaignRoutingRule.findUniqueOrThrow({ where: { id: world.ruleId } });
  return {
    destination: {
      destinationSubaccountIdGhl: destination.destinationSubaccountIdGhl,
      locationName: destination.locationName,
      sa360CustomFieldIdMapJson: destination.sa360CustomFieldIdMapJson,
      sourceAttributeFieldMapJson: destination.sourceAttributeFieldMapJson,
      destinationWorkflowIdGhl: destination.destinationWorkflowIdGhl,
      defaultAssignedUserIdGhl: destination.defaultAssignedUserIdGhl,
      workflowTriggerMode: destination.workflowTriggerMode,
      opportunityCreationEnabled: destination.opportunityCreationEnabled,
      deliveryEnabled: destination.deliveryEnabled,
      deliveryMode: destination.deliveryMode,
      clientCutoverApproved: destination.clientCutoverApproved,
      internalApprovalStatus: destination.internalApprovalStatus,
      snapshotInstalled: destination.snapshotInstalled,
      requiredFieldsInstalled: destination.requiredFieldsInstalled,
      ghlConnectionStatus: destination.ghlConnectionStatus,
      updatedAt: destination.updatedAt.toISOString(),
    },
    rule: {
      destinationSubaccountIdGhl: rule.destinationSubaccountIdGhl,
      destinationWorkflowIdGhl: rule.destinationWorkflowIdGhl,
      defaultAssignedUserIdGhl: rule.defaultAssignedUserIdGhl,
      deliveryEnabled: rule.deliveryEnabled,
      deliveryMode: rule.deliveryMode,
      clientCutoverApproved: rule.clientCutoverApproved,
      internalApprovalStatus: rule.internalApprovalStatus,
      readinessStatus: rule.readinessStatus,
      snapshotInstalled: rule.snapshotInstalled,
      requiredFieldsInstalled: rule.requiredFieldsInstalled,
      updatedAt: rule.updatedAt.toISOString(),
    },
  };
}

async function assertNoDeliverySideEffects(clientAccountId: string) {
  assert.equal(await prisma.ghlLiveDeliveryRun.count({ where: { destinationClientAccountId: clientAccountId } }), 0);
  assert.equal(await prisma.leadDeliveryPlan.count({ where: { destinationClientAccountId: clientAccountId } }), 0);
}

function canaryPlan(world: World): LeadDeliveryPlan & { steps: unknown[] } {
  return {
    id: `plan_${world.locationId}`,
    routingDryRunDecisionId: null,
    destinationSubaccountIdGhl: world.locationId,
    destinationClientAccountId: world.clientAccountId,
    sourceLeadUid: "lead_ops",
    sourceEmail: "ops@example.test",
    sourcePhoneE164: "+15555550111",
    planVersion: "1.0",
    status: "planned",
    steps: [],
    masterClientAccountId: "ops_master",
  } as unknown as LeadDeliveryPlan & { steps: unknown[] };
}

function defer() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
