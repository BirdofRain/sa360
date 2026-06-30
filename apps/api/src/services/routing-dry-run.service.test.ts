import test from "node:test";
import assert from "node:assert/strict";
import type { LifecycleEventSchema } from "../schemas/lifecycle-event.schema.js";
import {
  lifecycleEventsToEmitForDryRun,
  runRoutingDryRun,
  shouldRunRoutingDryRun,
} from "./routing-dry-run.service.js";
import { matchCampaignRoutingRule } from "./routing-matcher.service.js";

const samplePayload = {
  schema_version: "1",
  client_account_id: "master_1",
  contact: { lead_uid: "lead_1", contact_id_ghl: "ct_1" },
  state: {},
  attribution: { campaign_id: "camp_win" },
  event: {
    event_uuid: "ev_source",
    event_name_internal: "lead_created",
    event_name_meta: "Lead",
  },
} as LifecycleEventSchema;

test("shouldRunRoutingDryRun only for lead_created", () => {
  assert.equal(shouldRunRoutingDryRun(samplePayload), true);
  assert.equal(
    shouldRunRoutingDryRun({
      ...samplePayload,
      event: { ...samplePayload.event, event_name_internal: "appointment_set" },
    }),
    false
  );
});

test("lifecycleEventsToEmitForDryRun: matched emits lead_matched and lead_routed_dry_run", () => {
  const names = lifecycleEventsToEmitForDryRun({
    matched: true,
    confidence: "high",
    reason: "ok",
    destinationClientAccountId: "c1",
    destinationSubaccountIdGhl: "loc1",
  });
  assert.deepEqual(names, ["lead_matched", "lead_routed_dry_run"]);
});

test("lifecycleEventsToEmitForDryRun: unmatched emits routing_review_required", () => {
  const names = lifecycleEventsToEmitForDryRun({
    matched: false,
    confidence: "none",
    reason: "review",
  });
  assert.deepEqual(names, ["routing_review_required"]);
});

test("runRoutingDryRun persists decision and routing events without delivery", async () => {
  const saved: LifecycleEventSchema[] = [];
  const decisions: unknown[] = [];

  const mockPrisma = {
    campaignRoutingRule: {
      findMany: async () => [
        {
          id: "rule_1",
          masterClientAccountId: "master_1",
          clientAccountId: "client_dest",
          destinationSubaccountIdGhl: "loc_dest",
          clientDisplayName: "Dest Agent",
          nicheKey: null,
          productType: null,
          sourcePlatform: null,
          destinationWorkflowIdGhl: null,
          destinationPipelineIdGhl: null,
          destinationPipelineStageIdGhl: null,
          backupSheetEnabled: false,
          backupSheetId: null,
          defaultAssignedUserIdGhl: null,
          deliveryEnabled: false,
          shadowDeliveryEnabled: true,
          locationName: null,
          ghlConnectionStatus: null,
          snapshotInstalled: false,
          requiredFieldsInstalled: false,
          deliveryMode: "shadow",
          clientCutoverApproved: false,
          internalApprovalStatus: "not_reviewed",
          lastReadinessCheckAt: null,
          readinessStatus: "not_ready",
          readinessWarnings: null,
          opportunityCreationEnabled: true,
          sourceType: null,
          campaignId: "camp_win",
          campaignName: null,
          adsetId: null,
          adId: null,
          formId: null,
          utmCampaign: null,
          utmContent: null,
          masterDatasetId: null,
          matchType: "campaign_id",
          keywordPattern: null,
          priority: 100,
          active: true,
          effectiveStart: null,
          effectiveEnd: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    },
    routingDryRunDecision: {
      create: async (args: { data: unknown }) => {
        decisions.push(args.data);
        return { id: "dec_1", ...(args.data as object) };
      },
    },
  };

  const result = await runRoutingDryRun(samplePayload, {
    prisma: mockPrisma as never,
    now: () => new Date("2026-05-19T12:00:00.000Z"),
    saveLifecycleEvent: async (p) => {
      saved.push(p);
      return { id: "le_1" };
    },
  });

  assert.equal(result.matched, true);
  assert.equal(result.deliveryMode, "dry_run");
  assert.equal(result.destinationClientAccountId, "client_dest");
  assert.equal(decisions.length, 1);
  const decisionData = decisions[0] as {
    attributionSnapshot?: {
      leadIdentity?: {
        leadName?: string | null;
        firstName?: string | null;
        lastName?: string | null;
        phone?: string | null;
        email?: string | null;
        contactIdGhl?: string | null;
      };
    };
  };
  assert.deepEqual(decisionData.attributionSnapshot?.leadIdentity, {
    leadName: null,
    firstName: null,
    lastName: null,
    phone: null,
    email: null,
    contactIdGhl: "ct_1",
  });
  assert.equal(saved.length, 2);
  assert.ok(saved.every((p) => p.event.send_to_meta === false));
  for (const p of saved) {
    const routing = p.routing as Record<string, unknown> | undefined;
    assert.equal(routing?.delivery_mode, "dry_run");
    assert.equal(routing?.dry_run, true);
  }
  assert.ok(
    !saved.some(
      (p) => (p.routing as Record<string, unknown> | undefined)?.zapier_dispatch != null
    )
  );
});

test("runRoutingDryRun stores normalized lead identity in attribution snapshot", async () => {
  const decisions: Array<{ attributionSnapshot?: { leadIdentity?: Record<string, string | null> } }> = [];
  const payload = {
    ...samplePayload,
    contact: {
      lead_uid: "lead_identity",
      first_name: "Sam",
      last_name: "Tester",
      phone_e164: "+15550100111",
      email: "sam.canary.tester.003@example.test",
    },
  } as LifecycleEventSchema;

  const mockPrisma = {
    campaignRoutingRule: {
      findMany: async () => [],
    },
    routingDryRunDecision: {
      create: async (args: { data: unknown }) => {
        decisions.push(args.data as never);
        return { id: "dec_identity", ...(args.data as object) };
      },
    },
  };

  await runRoutingDryRun(payload, {
    prisma: mockPrisma as never,
    now: () => new Date("2026-05-19T12:00:00.000Z"),
    saveLifecycleEvent: async () => ({ id: "le_1" }),
  });

  assert.equal(decisions.length, 1);
  const leadIdentity = decisions[0]?.attributionSnapshot?.leadIdentity;
  assert.equal(leadIdentity?.leadName, "Sam Tester");
  assert.equal(leadIdentity?.phone, "+15550100111");
  assert.equal(leadIdentity?.email, "sam.canary.tester.003@example.test");
});

test("matcher-only path returns unmatched without destination", () => {
  const result = matchCampaignRoutingRule([], {
    masterClientAccountId: "m",
    campaignId: "x",
  });
  assert.equal(result.matched, false);
  assert.equal(result.destinationClientAccountId, undefined);
});
