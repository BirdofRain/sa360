import test, { after } from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/db.js";
import { buildLeadCaptureTrustPacketFromApiRecord } from "../leadcapture-data-api/leadcapture-trust-packet.js";
import {
  applyCorrelationToPacket,
  correlateLeadCaptureTrustPacket,
  LEGACY_SOURCE_EVENT_NOT_JOINABLE_BLOCKER,
} from "./leadcapture-trust-correlation.service.js";
import {
  LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY,
  LEADCAPTURE_TRUST_PILOT_CLIENT_ACCOUNT_ID,
} from "./leadcapture-trust.constants.js";

const campaignId = LEADCAPTURE_TRUST_PILOT_CAMPAIGN_KEY;
const suffix = `corr-${Date.now()}`;
const createdEventIds: string[] = [];

const NEXTGEN_UUID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const OTHER_UUID = "cccccccc-dddd-4eee-8fff-000000000000";

async function seedSourceLeadEvent(input: {
  sourceLeadId: string;
  sourceSystem?: "leadcapture_io_legacy" | "leadcapture_io_nextgen";
  externalEventUuid?: string;
  sourceRouteKey?: string;
  clientAccountIdResolved?: string;
  sourceProvider?: "leadcapture_io" | "facebook";
  phone?: string;
  email?: string;
  receivedAt?: Date;
}) {
  const sourceSystem = input.sourceSystem ?? "leadcapture_io_nextgen";
  const event = await prisma.sourceLeadEvent.create({
    data: {
      sourceLeadId: input.sourceLeadId,
      sourceLeadUid: `leadcaptureio-${sourceSystem}-${input.sourceLeadId}`,
      sourceProvider: input.sourceProvider ?? "leadcapture_io",
      sourceSystem,
      sourceType: "webhook",
      sourceRouteKey: input.sourceRouteKey ?? campaignId,
      clientAccountIdResolved: input.clientAccountIdResolved ?? LEADCAPTURE_TRUST_PILOT_CLIENT_ACCOUNT_ID,
      receivedAt: input.receivedAt ?? new Date("2026-06-16T11:25:41.000Z"),
      rawPayloadJson: { test: true, suffix },
      normalizedPayloadJson: {
        event: input.externalEventUuid ? { event_uuid: input.externalEventUuid } : undefined,
        contact: {
          lead_uid: `leadcaptureio-${sourceSystem}-${input.sourceLeadId}`,
          phone_e164: input.phone,
          email: input.email,
        },
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

test("correlation exact_match on identical NextGen UUID", async () => {
  await seedSourceLeadEvent({
    sourceLeadId: NEXTGEN_UUID,
    sourceSystem: "leadcapture_io_nextgen",
  });

  const providerRecord = {
    tcpa_consent: true,
    _meta: { lead_id: NEXTGEN_UUID, funnel_id: "d6f2157f-d612-441a-80af-88742ef084dc" },
  };
  const packet = buildLeadCaptureTrustPacketFromApiRecord(providerRecord);
  const result = await correlateLeadCaptureTrustPacket({
    campaignId,
    packet,
    providerRecord,
  });
  const applied = applyCorrelationToPacket(packet, result);

  assert.equal(result.classification, "exact_match");
  assert.ok(result.matchedEvent);
  assert.equal(applied.assessment.canAttach, true);
});

test("correlation wrong UUID gives no exact match", async () => {
  await seedSourceLeadEvent({
    sourceLeadId: NEXTGEN_UUID,
    sourceSystem: "leadcapture_io_nextgen",
  });

  const providerRecord = {
    tcpa_consent: true,
    _meta: { lead_id: OTHER_UUID, funnel_id: "d6f2157f-d612-441a-80af-88742ef084dc" },
  };
  const packet = buildLeadCaptureTrustPacketFromApiRecord(providerRecord);
  const result = await correlateLeadCaptureTrustPacket({
    campaignId,
    packet,
    providerRecord,
  });

  assert.equal(result.classification, "no_match");
  assert.equal(result.matchedEvent, null);
});

test("correlation duplicate UUID matches remain ambiguous", async () => {
  await seedSourceLeadEvent({
    sourceLeadId: NEXTGEN_UUID,
    sourceSystem: "leadcapture_io_nextgen",
  });
  await seedSourceLeadEvent({
    sourceLeadId: NEXTGEN_UUID,
    sourceSystem: "leadcapture_io_nextgen",
  });

  const providerRecord = {
    tcpa_consent: true,
    _meta: { lead_id: NEXTGEN_UUID, funnel_id: "d6f2157f-d612-441a-80af-88742ef084dc" },
  };
  const packet = buildLeadCaptureTrustPacketFromApiRecord(providerRecord);
  const result = await correlateLeadCaptureTrustPacket({
    campaignId,
    packet,
    providerRecord,
  });

  assert.equal(result.classification, "ambiguous");
  assert.equal(result.blockers.includes("multiple_provider_lead_id_matches"), true);
});

test("numeric legacy sourceLeadId never exact-matches Data API UUID", async () => {
  await seedSourceLeadEvent({
    sourceLeadId: "4652453",
    sourceSystem: "leadcapture_io_legacy",
  });

  const providerRecord = {
    tcpa_consent: true,
    _meta: { lead_id: NEXTGEN_UUID, funnel_id: "d6f2157f-d612-441a-80af-88742ef084dc" },
  };
  const packet = buildLeadCaptureTrustPacketFromApiRecord(providerRecord);
  const result = await correlateLeadCaptureTrustPacket({
    campaignId,
    packet,
    providerRecord,
  });
  const applied = applyCorrelationToPacket(packet, result);

  assert.notEqual(result.classification, "exact_match");
  assert.equal(applied.assessment.canAttach, false);
});

test("external event alone without UUID equality is not exact_match", async () => {
  const externalUuid = `ext-${suffix}-1`;
  await seedSourceLeadEvent({
    sourceLeadId: `db-lead-${suffix}-1`,
    sourceSystem: "leadcapture_io_legacy",
    externalEventUuid: externalUuid,
  });

  const providerRecord = {
    event_uuid: externalUuid,
    tcpa_consent: true,
    _meta: { lead_id: NEXTGEN_UUID, funnel_id: "d6f2157f-d612-441a-80af-88742ef084dc" },
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

test("identity/time fallback for legacy remains preview-only with legacy blocker", async () => {
  // Isolated UUID/timestamp/phone so prior exact-match seeds for NEXTGEN_UUID cannot short-circuit.
  const identityOnlyUuid = "dddddddd-eeee-4fff-8000-111111111111";
  const submittedAt = new Date("2099-01-02T03:04:05.000Z");
  const phone = `+1555${String(Date.now()).slice(-7)}`;
  await seedSourceLeadEvent({
    sourceLeadId: "4652499",
    sourceSystem: "leadcapture_io_legacy",
    phone,
    receivedAt: submittedAt,
  });

  const providerRecord = {
    phone,
    submitted_at: submittedAt.toISOString(),
    tcpa_consent: true,
    _meta: { lead_id: identityOnlyUuid, funnel_id: "d6f2157f-d612-441a-80af-88742ef084dc" },
  };
  const packet = buildLeadCaptureTrustPacketFromApiRecord(providerRecord);
  const result = await correlateLeadCaptureTrustPacket({
    campaignId,
    packet,
    providerRecord,
  });
  const applied = applyCorrelationToPacket(packet, result);

  assert.equal(result.classification, "preview_identity_match");
  assert.equal(applied.assessment.canAttach, false);
  assert.equal(result.blockers.includes(LEGACY_SOURCE_EVENT_NOT_JOINABLE_BLOCKER), true);
  assert.equal(
    result.blockers.includes("preview_only_identity_match_requires_explicit_source_lead_event_id"),
    true
  );
});

test("correlation rejects wrong campaign client and lane", async () => {
  await seedSourceLeadEvent({
    sourceLeadId: NEXTGEN_UUID,
    sourceSystem: "leadcapture_io_nextgen",
    sourceRouteKey: "OTHER_CAMPAIGN",
    clientAccountIdResolved: "other_client",
    sourceProvider: "facebook",
  });

  const providerRecord = {
    tcpa_consent: true,
    _meta: { lead_id: NEXTGEN_UUID, funnel_id: "d6f2157f-d612-441a-80af-88742ef084dc" },
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
