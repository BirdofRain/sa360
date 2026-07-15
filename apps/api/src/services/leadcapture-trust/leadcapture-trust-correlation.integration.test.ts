import test, { after } from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/db.js";
import { buildLeadCaptureTrustPacketFromApiRecord } from "../leadcapture-data-api/leadcapture-trust-packet.js";
import { correlateLeadCaptureTrustPacket } from "./leadcapture-trust-correlation.service.js";
import {
  LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY,
  LEADCAPTURE_TRUST_PILOT_CLIENT_ACCOUNT_ID,
} from "./leadcapture-trust.constants.js";

const campaignId = LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY;
const suffix = `corr-${Date.now()}`;
const createdEventIds: string[] = [];

async function seedSourceLeadEvent(input: {
  sourceLeadId: string;
  externalEventUuid?: string;
  sourceRouteKey?: string;
  clientAccountIdResolved?: string;
  sourceProvider?: "leadcapture_io" | "facebook";
}) {
  const event = await prisma.sourceLeadEvent.create({
    data: {
      sourceLeadId: input.sourceLeadId,
      sourceProvider: input.sourceProvider ?? "leadcapture_io",
      sourceSystem: "leadcapture_io_legacy",
      sourceType: "webhook",
      sourceRouteKey: input.sourceRouteKey ?? campaignId,
      clientAccountIdResolved: input.clientAccountIdResolved ?? LEADCAPTURE_TRUST_PILOT_CLIENT_ACCOUNT_ID,
      rawPayloadJson: { test: true, suffix },
      normalizedPayloadJson: {
        event: input.externalEventUuid ? { event_uuid: input.externalEventUuid } : undefined,
        contact: { lead_uid: `leadcaptureio-leadcapture_io_legacy-${input.sourceLeadId}` },
      },
    },
  });
  createdEventIds.push(event.id);
  return event;
}

after(async () => {
  if (createdEventIds.length === 0) return;
  await prisma.sourceLeadEvent.deleteMany({ where: { id: { in: createdEventIds } } });
});

test("correlation matches exact external event when providerLeadId differs", async () => {
  const externalUuid = `ext-${suffix}-1`;
  await seedSourceLeadEvent({
    sourceLeadId: `db-lead-${suffix}-1`,
    externalEventUuid: externalUuid,
  });

  const providerRecord = {
    event_uuid: externalUuid,
    tcpa_consent: true,
    _meta: { lead_id: `provider-lead-${suffix}-1`, funnel_id: "d6f2157f-d612-441a-80af-88742ef084dc" },
  };
  const packet = buildLeadCaptureTrustPacketFromApiRecord(providerRecord);
  const result = await correlateLeadCaptureTrustPacket({
    campaignId,
    packet,
    providerRecord,
  });

  assert.equal(result.classification, "exact_match");
  assert.ok(result.matchedEvent);
  assert.equal(result.blockers.length, 0);
});

test("correlation rejects ambiguous external event matches", async () => {
  const externalUuid = `ext-${suffix}-ambiguous`;
  await seedSourceLeadEvent({
    sourceLeadId: `db-lead-${suffix}-a`,
    externalEventUuid: externalUuid,
  });
  await seedSourceLeadEvent({
    sourceLeadId: `db-lead-${suffix}-b`,
    externalEventUuid: externalUuid,
  });

  const providerRecord = {
    event_uuid: externalUuid,
    tcpa_consent: true,
    _meta: { lead_id: `provider-lead-${suffix}-ambiguous`, funnel_id: "d6f2157f-d612-441a-80af-88742ef084dc" },
  };
  const packet = buildLeadCaptureTrustPacketFromApiRecord(providerRecord);
  const result = await correlateLeadCaptureTrustPacket({
    campaignId,
    packet,
    providerRecord,
  });

  assert.equal(result.classification, "ambiguous");
  assert.equal(result.blockers.includes("multiple_external_event_matches"), true);
});

test("correlation rejects wrong campaign client and lane for external event", async () => {
  const externalUuid = `ext-${suffix}-scope`;
  await seedSourceLeadEvent({
    sourceLeadId: `db-lead-${suffix}-scope`,
    externalEventUuid: externalUuid,
    sourceRouteKey: "OTHER_CAMPAIGN",
    clientAccountIdResolved: "other_client",
    sourceProvider: "facebook",
  });

  const providerRecord = {
    event_uuid: externalUuid,
    tcpa_consent: true,
    _meta: { lead_id: `provider-lead-${suffix}-scope`, funnel_id: "d6f2157f-d612-441a-80af-88742ef084dc" },
  };
  const packet = buildLeadCaptureTrustPacketFromApiRecord(providerRecord);
  const result = await correlateLeadCaptureTrustPacket({
    campaignId,
    packet,
    providerRecord,
  });

  assert.notEqual(result.classification, "exact_match");
  assert.equal(result.matchedEvent, null);
});
