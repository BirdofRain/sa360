import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  planLegacyLeadCaptureFormEventRepair,
  repairLegacyLeadCaptureFormEvent,
} from "./leadcapture-legacy-form-repair.service.js";
import { processLeadCaptureIoWebhookIntake } from "./source-lead-intake.service.js";
import { associateSourceFunnelByPageUrl } from "./source-funnel.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/leadcaptureio/leadcaptureio-webhook-sample-legacy-form-envelope-complete.json"
);

describe("Legacy native form envelope inventory", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const clientAccountId = `legacy_form_nick_${stamp}`;
  const parentUrl = `https://go.lifeinsuranceforvets.com/legacy-form-${stamp}?utm_source=facebook`;
  const parentUrlKey = `go.lifeinsuranceforvets.com/legacy-form-${stamp}`;
  const providerFormId = String(7_000_000 + Number(stamp.slice(-6)));
  const createdEventIds: string[] = [];

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.clientAccount.create({
      data: {
        clientAccountId,
        clientDisplayName: "Nicholas D'Ambruoso Legacy Form Test",
        status: "active",
      },
    });
    await associateSourceFunnelByPageUrl(
      { originClientAccountId: clientAccountId, pageUrlOrSlug: parentUrl },
      db
    );
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

  it("creates VET inventory with source time and confirmed page origin, without delivery", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      form: Record<string, unknown>;
    };
    raw.form.lead_id = Number(providerFormId) + 1;
    raw.form.lead_form = Number(providerFormId);
    raw.form.parent_url = parentUrl;
    raw.form.email = `legacy.form.${stamp}@example.test`;
    raw.form.phone = `555${stamp.slice(-7)}`;

    const routeKey = `LCIO_LEGACY_VET_LIFE_NATIVE_FORM_${stamp}_VET_FEX`;
    const result = await processLeadCaptureIoWebhookIntake({
      rawPayload: raw,
      routeKeyFromPath: routeKey,
    });
    createdEventIds.push(result.sourceEventId);

    assert.equal(result.sourceLeadId, String(raw.form.lead_id));
    assert.equal(result.sourceLeadIdGenerated, false);
    assert.equal(result.matched, false);
    assert.equal(result.destinationClientAccountId, undefined);
    assert.equal(result.inventoryTracking?.ok, true);

    const event = await db.sourceLeadEvent.findUnique({
      where: { id: result.sourceEventId },
      include: { leadInventoryItem: true, fulfillmentOutboxItems: true },
    });
    assert.ok(event);
    assert.equal(event.sourceCampaignId, providerFormId);
    assert.equal(event.clientAccountIdResolved, null);
    assert.equal(event.deliveryResultJson, null);
    assert.equal(event.fulfillmentOutboxItems.length, 0);
    assert.ok(event.leadInventoryItem);
    assert.equal(event.leadInventoryItem?.generatedAt.toISOString(), "2026-10-06T18:21:16.000Z");
    assert.equal(event.leadInventoryItem?.nicheKey, "vet");
    assert.equal(event.leadInventoryItem?.originClientAccountId, clientAccountId);

    const funnel = await db.sourceFunnel.findUnique({
      where: {
        provider_parentUrlKey: { provider: "leadcapture_io", parentUrlKey },
      },
    });
    assert.equal(funnel?.providerFunnelId, providerFormId);
    assert.equal(funnel?.associationStatus, "confirmed");
    assert.equal(funnel?.originClientAccountId, clientAccountId);
  });

  it("repairs one generated-ID event in place and creates at most one inventory item", async () => {
    const sourceEventId = `legacy-repair-${stamp}`;
    const leadId = String(Number(providerFormId) + 2);
    const routeKey = `LCIO_LEGACY_VET_LIFE_REPAIR_${stamp}_VET_FEX`;
    const rawPayloadJson = {
      form: {
        lead_id: Number(leadId),
        lead_form: Number(providerFormId),
        date: "2026-10-06",
        time: "18:21:16",
        parent_url: parentUrl,
        first_name: "Repair",
        last_name: "Candidate",
        email: `legacy.repair.${stamp}@example.test`,
        phone: `556${stamp.slice(-7)}`,
        state: "TX",
      },
    };
    await db.sourceLeadEvent.create({
      data: {
        id: sourceEventId,
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_legacy",
        sourceType: "lead_form",
        sourceRouteKey: routeKey,
        sourceCampaignId: routeKey,
        sourceLeadId: `gen-${stamp.slice(-16).padStart(16, "0")}`,
        sourceLeadUid: `leadcaptureio-leadcapture_io_legacy-gen-${stamp}`,
        status: "routing_unmatched",
        rawPayloadJson,
        normalizedPayloadJson: {
          routing: {
            source_intake: {
              source_lead_id_generated: true,
            },
          },
        },
      },
    });
    createdEventIds.push(sourceEventId);

    const stored = await db.sourceLeadEvent.findUniqueOrThrow({
      where: { id: sourceEventId },
    });
    const plan = planLegacyLeadCaptureFormEventRepair(stored);
    assert.equal(plan.eligible, true);
    if (plan.eligible) assert.equal(plan.sourceLeadId, leadId);

    const preview = await repairLegacyLeadCaptureFormEvent({ sourceEventId }, db);
    assert.equal(preview.eligible, true);
    assert.equal(await db.leadInventoryItem.count({ where: { sourceLeadEventId } }), 0);

    const repaired = await repairLegacyLeadCaptureFormEvent(
      { sourceEventId, apply: true },
      db
    );
    assert.equal(repaired.eligible, true);
    assert.equal("applied" in repaired && repaired.applied, true);
    const rows = await db.sourceLeadEvent.findMany({ where: { id: sourceEventId } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.sourceLeadId, leadId);
    assert.equal(
      (rows[0]?.normalizedPayloadJson as {
        routing?: { source_intake?: { source_lead_id_generated?: boolean } };
      })?.routing?.source_intake?.source_lead_id_generated,
      false
    );
    assert.equal(await db.leadInventoryItem.count({ where: { sourceLeadEventId } }), 1);
  });
});
