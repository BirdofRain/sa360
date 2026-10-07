import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { normalizeLeadCaptureIoWebhookToLifecyclePayload } from "./leadcapture-io-normalizer.js";
import {
  LEADCAPTURE_RECONCILE_CONFIRMATION,
  reconcileOneLeadCaptureSourceEventAssociation,
} from "./leadcapture-one-event-reconcile.service.js";
import { processLeadCaptureIoWebhookIntake } from "./source-lead-intake.service.js";
import { associateSourceFunnelByPageUrl } from "./source-funnel.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/leadcaptureio/leadcaptureio-webhook-sample-legacy-form-envelope-complete.json"
);

describe("Legacy native form envelope association and inventory", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  let databaseUrl: string;
  let dbHost: string;
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const clientAccountId = `legacy_form_nick_${stamp}`;
  const parentUrl = `https://go.lifeinsuranceforvets.com/legacy-form-${stamp}/?utm_source=facebook#form`;
  const parentUrlKey = `go.lifeinsuranceforvets.com/legacy-form-${stamp}`;
  const providerFormId = String(7_000_000 + Number(stamp.slice(-6)));
  const routeKey = `LCIO_LEGACY_VET_LIFE_NATIVE_FORM_${stamp}_VET_FEX`;
  const createdEventIds: string[] = [];

  before(async () => {
    databaseUrl = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = databaseUrl;
    dbHost = new URL(databaseUrl).hostname;
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.clientAccount.create({
      data: {
        clientAccountId,
        clientDisplayName: "Nicholas D'Ambruoso Legacy Form Test",
        status: "active",
      },
    });
    const associated = await associateSourceFunnelByPageUrl(
      { originClientAccountId: clientAccountId, pageUrlOrSlug: parentUrl },
      db
    );
    await db.sourceFunnel.update({
      where: { id: associated.sourceFunnel.id },
      data: { providerFunnelId: providerFormId },
    });
  });

  after(async () => {
    if (createdEventIds.length > 0) {
      await db.leadInventoryItem.deleteMany({
        where: { sourceLeadEventId: { in: createdEventIds } },
      });
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    await db.sourceFunnel.deleteMany({
      where: { provider: "leadcapture_io", parentUrlKey },
    });
    await db.clientAccount.deleteMany({ where: { clientAccountId } });
    await db?.$disconnect();
  });

  it("routes from the confirmed shared identity and remains delivery-side-effect free", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      form: Record<string, unknown>;
    };
    raw.form.lead_id = Number(providerFormId) + 1;
    raw.form.lead_form = Number(providerFormId);
    raw.form.parent_url = parentUrl;
    raw.form.email = `legacy.form.${stamp}@example.test`;
    raw.form.phone = `555${stamp.slice(-7)}`;

    const result = await processLeadCaptureIoWebhookIntake({
      rawPayload: raw,
      routeKeyFromPath: routeKey,
    });
    createdEventIds.push(result.sourceEventId);

    assert.equal(result.sourceLeadId, String(raw.form.lead_id));
    assert.equal(result.sourceLeadIdGenerated, false);
    assert.equal(result.matched, true);
    assert.equal(result.matchedRuleId, undefined);
    assert.equal(result.destinationClientAccountId, clientAccountId);
    assert.equal(result.inventoryTracking?.ok, true);

    const event = await db.sourceLeadEvent.findUnique({
      where: { id: result.sourceEventId },
      include: { leadInventoryItem: true, fulfillmentOutboxItems: true },
    });
    assert.ok(event);
    // Legacy campaign/rule identity remains the route key; shared source signals
    // resolve provider form/page identity independently.
    assert.equal(event.sourceCampaignId, routeKey);
    assert.equal(event.clientAccountIdResolved, clientAccountId);
    assert.equal(event.routingRuleIdResolved, null);
    assert.equal(event.deliveredAt, null);
    assert.equal(event.deliveryResultJson, null);
    assert.equal(event.fulfillmentOutboxItems.length, 0);

    const routing = event.routingResultJson as Record<string, unknown>;
    assert.equal(routing.routingAuthority, "confirmed_source_association");
    const evidence = routing.sourceAssociation as Record<string, unknown>;
    assert.equal(evidence.matchedBy, "provider_form_id");
    assert.equal(evidence.matchEvidence, providerFormId);
    assert.equal(evidence.parentUrlKey, parentUrlKey);

    const normalized = event.normalizedPayloadJson as {
      lead_details?: { consumer_age?: string; date_of_birth?: string };
      routing?: {
        source_intake?: {
          form_id?: string;
          lead_form?: string;
          parent_url_key?: string;
          submitted_at?: string;
          generated_at?: string;
        };
      };
    };
    assert.equal(normalized.routing?.source_intake?.form_id, providerFormId);
    assert.equal(normalized.routing?.source_intake?.lead_form, providerFormId);
    assert.equal(normalized.routing?.source_intake?.parent_url_key, parentUrlKey);
    assert.equal(normalized.routing?.source_intake?.submitted_at, "2026-10-06T18:21:16.000Z");
    assert.equal(normalized.routing?.source_intake?.generated_at, "2026-10-06T18:21:16.000Z");
    assert.equal(normalized.lead_details?.date_of_birth, "1979-04-12");
    assert.equal(normalized.lead_details?.consumer_age, "47");

    assert.ok(event.leadInventoryItem);
    assert.equal(event.leadInventoryItem?.generatedAt.toISOString(), "2026-10-06T18:21:16.000Z");
    assert.equal(event.leadInventoryItem?.nicheKey, "vet");
    assert.equal(event.leadInventoryItem?.originClientAccountId, clientAccountId);

    const funnels = await db.sourceFunnel.findMany({
      where: {
        provider: "leadcapture_io",
        OR: [{ parentUrlKey }, { providerFunnelId }],
      },
    });
    assert.equal(funnels.length, 1);
    assert.equal(funnels[0]?.providerFunnelId, providerFormId);
    assert.equal(funnels[0]?.parentUrlKey, parentUrlKey);
    assert.equal(funnels[0]?.associationStatus, "confirmed");
    assert.equal(funnels[0]?.originClientAccountId, clientAccountId);
    assert.ok(funnels[0]?.firstSeenAt);
    assert.ok(funnels[0]?.lastSeenAt);

    assert.equal(
      await db.leadAllocation.count({ where: { sourceLeadEventId: result.sourceEventId } }),
      0
    );
    assert.equal(
      await db.metaDispatchAttempt.count({ where: { eventUuid: event.sourceLeadUid ?? "" } }),
      0
    );
    assert.equal(
      await db.leadDeliveryPlan.count({
        where: { routingDryRunDecisionId: event.routingDryRunDecisionId },
      }),
      0
    );
  });

  it("uses the canonical one-event reconcile to repair a generated native-form identity idempotently", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      form: Record<string, unknown>;
    };
    const correctedLeadId = String(Number(providerFormId) + 2);
    raw.form.lead_id = Number(correctedLeadId);
    raw.form.lead_form = Number(providerFormId);
    raw.form.parent_url = parentUrl;
    raw.form.email = `legacy.reconcile.${stamp}@example.test`;
    raw.form.phone = `556${stamp.slice(-7)}`;

    // Emulate the persisted pre-fix shape: valid lifecycle payload, but the
    // native form envelope was invisible so identity and source time were generated/missing.
    const preFixNormalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(
      {
        provider: "leadcapture_io",
        sa360_source_system: "leadcapture_io_legacy",
        sa360_route_key: routeKey,
        email: raw.form.email,
        phone: raw.form.phone,
        state: raw.form.state,
      },
      { routeKeyFromPath: routeKey }
    );
    const preFixIntake = (
      preFixNormalized.routing as { source_intake?: Record<string, unknown> }
    ).source_intake;
    assert.equal(preFixIntake?.source_lead_id_generated, true);
    assert.equal(preFixIntake?.generated_at, undefined);
    const generatedLeadId = String(preFixIntake?.lead_id);

    const event = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_legacy",
        sourceType: "lead_form",
        sourceRouteKey: routeKey,
        sourceCampaignId: routeKey,
        sourceLeadId: generatedLeadId,
        sourceLeadUid: preFixNormalized.contact.lead_uid,
        status: "routing_unmatched",
        rawPayloadJson: raw,
        normalizedPayloadJson: preFixNormalized as object,
      },
    });
    createdEventIds.push(event.id);

    const args = {
      sourceEventId: event.id,
      expectedSourceSystem: "leadcapture_io_legacy",
      expectedRoute: routeKey,
      expectedLeadId: generatedLeadId,
      expectedDestinationClientAccountId: clientAccountId,
      expectedDbHost: dbHost,
      operator: "legacy-form-integration-test",
      confirm: LEADCAPTURE_RECONCILE_CONFIRMATION,
      databaseUrl,
    };

    const preview = await reconcileOneLeadCaptureSourceEventAssociation(args, {
      prisma: db,
    });
    assert.equal(preview.outcome, "PREVIEWED");
    assert.equal(preview.writesAttempted, false);
    assert.ok(
      preview.plannedActions?.includes(
        "repair_generated_legacy_identity_and_renormalize_existing_event"
      )
    );
    assert.equal(await db.leadInventoryItem.count({ where: { sourceLeadEventId: event.id } }), 0);

    const applied = await reconcileOneLeadCaptureSourceEventAssociation(
      { ...args, apply: true },
      { prisma: db }
    );
    assert.equal(applied.outcome, "RECONCILED");
    assert.equal(applied.after?.sourceEventId, event.id);
    assert.equal(applied.after?.sourceLeadId, correctedLeadId);
    assert.equal(applied.after?.inventoryCount, 1);
    assert.equal(applied.after?.fulfillmentOutboxCount, 0);
    assert.equal(applied.after?.allocationCount, 0);
    assert.equal(applied.after?.ghlDeliveryAttempted, false);
    assert.equal(applied.after?.metaDispatchCount, 0);

    // Same guarded invocation is idempotent even though its expected lead id is
    // the original generated value recorded in the repair marker.
    const replay = await reconcileOneLeadCaptureSourceEventAssociation(
      { ...args, apply: true },
      { prisma: db }
    );
    assert.equal(replay.outcome, "RECONCILED");
    assert.equal(replay.after?.sourceEventId, event.id);
    assert.equal(replay.after?.sourceLeadId, correctedLeadId);
    assert.equal(replay.after?.inventoryCount, 1);
    assert.equal(replay.inventory?.reused, true);
  });
});
