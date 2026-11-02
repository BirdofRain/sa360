/**
 * Local sa360_test proof for the Sheets person gate. No Google and no Zapier calls.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import {
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
  COMPANY_SHEETS_LEAD_HEADER,
} from "../../lib/company-google-sheets-env.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { recordDuplicateRiskAssessmentFailure } from "../../repositories/lead-duplicate-risk.repository.js";
import { enqueueConfirmedLeadSheetsDelivery } from "../company-sheets-delivery/company-sheets-delivery.service.js";
import { processDueCompanySheetsDispatches } from "./company-sheets-dispatch.service.js";
import { recoverClientSheetsPersonHold } from "./client-sheets-person-recovery.js";
import { ROUTING_AUTHORITY_SOURCE_ASSOCIATION } from "../routing-source-association.service.js";
import { recordGhlAssociationDispatchOutbox } from "../ghl-association-dispatch/ghl-association-dispatch.js";
import { recordCompanySheetsCampaignIntent } from "./company-sheets-dispatch-record.js";
import { COMPANY_SHEETS_PILOT_ROUTE_KEY } from "@sa360/shared";

import {
  evaluateClientSheetsPersonGate,
  importVerifiedZapSheetsBaseline,
  noteSheetsPersonDelivery,
  planPreMigrationLeadJobQuarantine,
  prepareClientSheetsHistoryBaseline,
  readClientSheetsHistoryCoverage,
  releaseKnownDeadSheetsPersonReservation,
  SHEETS_PERSON_POLICY,
  sheetsPersonIdentifiers,
} from "./client-sheets-person-gate.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

describe("client sheets person gate (local sa360_test)", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const suffix = `${Date.now()}`;
  const client = {
    gate: `cspg_${suffix}`,
    other: `cspg_other_${suffix}`,
    sheets: `cspg_sheets_${suffix}`,
  };
  let sequence = 0;
  const leadIds: string[] = [];
  const decisionIds: string[] = [];
  let connectionId = "";
  let createdConnection = false;

  function phone(): string {
    sequence += 1;
    return `+15552${String(sequence).padStart(6, "0")}`;
  }

  function email(label: string): string {
    return `${label}.${sequence}.${suffix}@example.com`;
  }

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.clientAccount.createMany({
      data: Object.values(client).map((clientAccountId) => ({
        clientAccountId,
        clientDisplayName: clientAccountId,
        status: "active",
      })),
    });
    let connection = await db.companyGoogleConnection.findUnique({ where: { connectionKey: "life_agent_launch" } });
    if (!connection) {
      connection = await db.companyGoogleConnection.create({
        data: {
          connectionKey: "life_agent_launch",
          googleUserId: `person-gate-${suffix}`,
          googleEmail: "person-gate@lifeagentlaunch.test",
          status: "connected",
          scopes: ["openid", "email"],
          tokenVersion: 1,
        },
      });
      createdConnection = true;
    }
    connectionId = connection.id;
    const destination = await db.companySheetsDestination.create({
      data: {
        clientAccountId: client.sheets,
        companyConnectionId: connectionId,
        spreadsheetId: `sheetPerson${suffix}`,
        spreadsheetTitle: "Person",
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/sheetPerson${suffix}`,
        worksheetId: 0,
        worksheetTitle: "Campaign Leads",
        controlBasis: "drive_owner_verified",
        accessStatus: "readable",
        sharingStatus: "missing_recipient",
        enabled: false,
        campaignDispatchEnabled: true,
        campaignDispatchNotBefore: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    await db.companySheetsTabContract.create({
      data: {
        destinationId: destination.id,
        role: "campaign",
        setupState: "bound",
        worksheetId: 0,
        worksheetTitle: "Campaign Leads",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
        headerContract: [...COMPANY_SHEETS_LEAD_HEADER],
        boundAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
  });

  after(async () => {
    if (!db) return;
    const ids = Object.values(client);
    await db.clientSheetsPersonAdmission.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.clientSheetsPersonRelease.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.clientSheetsHistoryCoverage.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.clientSheetsDedupeDecision.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companySheetsDispatchIntent.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companySheetsDeliveryJob.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.ghlAssociationDispatchOutbox.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companySheetsDestination.deleteMany({ where: { clientAccountId: { in: ids } } });
    if (leadIds.length > 0) await db.sourceLeadEvent.deleteMany({ where: { id: { in: leadIds } } });
    if (decisionIds.length > 0) {
      await db.duplicateRiskAssessmentFailure.deleteMany({ where: { routingDryRunDecisionId: { in: decisionIds } } });
      await db.leadDuplicateRiskAssessment.deleteMany({ where: { routingDryRunDecisionId: { in: decisionIds } } });
      await db.routingDryRunDecision.deleteMany({ where: { id: { in: decisionIds } } });
    }
    if (createdConnection) {
      const leftover = await db.companySheetsDestination.count({ where: { companyConnectionId: connectionId } });
      if (leftover === 0) await db.companyGoogleConnection.delete({ where: { id: connectionId } });
    }
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.$disconnect();
  });

  async function makeLead(input: {
    clientAccountId: string;
    phone?: string | null;
    email?: string | null;
    name?: string;
    decisionId?: string | null;
    routeKey?: string;
    sourceProvider?: string;
  }) {
    const lead = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: input.sourceProvider ?? "manual_import",
        sourceSystem: "external_vendor",
        sourceType: "manual_entry",
        sourceRouteKey: input.routeKey ?? null,
        clientAccountIdResolved: input.clientAccountId,
        status: "routing_matched",
        rawPayloadJson: { fixture: true },
        normalizedPayloadJson: {
          first_name: input.name ?? "Ada",
          last_name: "Lovelace",
          full_name: input.name ?? "Ada Lovelace",
          email: input.email ?? null,
          phone: input.phone ?? null,
        },
        routingDryRunDecisionId: input.decisionId ?? null,
        receivedAt: new Date(),
      },
    });
    leadIds.push(lead.id);
    return lead;
  }

  async function makeDecision(riskLevel: string | null, identityStatus = "linked") {
    const decision = await db.routingDryRunDecision.create({
      data: {
        masterClientAccountId: client.sheets,
        sourceLeadUid: `uid_${suffix}_${decisionIds.length}`,
        matched: true,
        confidence: "high",
        matchReason: "person gate test",
        routingEventNameInternal: "lead_matched",
        destinationClientAccountId: client.sheets,
      },
    });
    decisionIds.push(decision.id);
    if (riskLevel) {
      await db.leadDuplicateRiskAssessment.create({
        data: {
          masterClientAccountId: client.sheets,
          routingDryRunDecisionId: decision.id,
          riskLevel,
          identityStatus,
          sourceLeadUid: decision.sourceLeadUid,
        },
      });
    }
    return decision;
  }

  const dispatchEnv = {
    ...process.env,
    SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED: "true",
    SA360_GHL_ONGOING_DELIVERY_ENABLED: "true",
  };

  async function payloadIdentity(leadId: string) {
    const lead = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: leadId } });
    return sheetsPersonIdentifiers(lead.normalizedPayloadJson);
  }

  it("blocks a repeated event, a reformatted new source, and keeps another client separate", async () => {
    const punctuated = "(555) 246-8135";
    const national = "5552468135";
    const normalizedPhone = "+15552468135";
    const mixedEmail = `Ada.Format.${suffix}@Example.com`;
    const first = await makeLead({
      clientAccountId: client.gate,
      phone: punctuated,
      email: mixedEmail,
      sourceProvider: "leadcapture_io",
      routeKey: "vendor-a",
    });
    const firstIdentity = await payloadIdentity(first.id);
    assert.equal(firstIdentity.phone, normalizedPhone);
    assert.equal(firstIdentity.email, `ada.format.${suffix}@example.com`);
    const again = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.gate,
      sourceLeadEventId: first.id,
    });
    const replay = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.gate,
      sourceLeadEventId: first.id,
    });
    assert.equal(again.code, "admitted");
    assert.equal(replay.code, "replay_allowed");
    assert.equal(
      await db.clientSheetsPersonAdmission.count({
        where: { clientAccountId: client.gate, normalizedValue: normalizedPhone },
      }),
      1
    );

    const second = await makeLead({
      clientAccountId: client.gate,
      phone: national,
      email: `other-format.${suffix}@example.com`,
      sourceProvider: "manual_import",
      routeKey: "vendor-b",
    });
    const secondIdentity = await payloadIdentity(second.id);
    assert.equal(secondIdentity.phone, firstIdentity.phone);
    assert.notEqual(secondIdentity.email, firstIdentity.email);
    assert.notEqual(second.sourceProvider, first.sourceProvider);
    const duplicate = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.gate,
      sourceLeadEventId: second.id,
    });
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.code, "person_duplicate");
    assert.equal(duplicate.intentStatus, "duplicate_held");
    assert.equal(duplicate.reason, "normalized_identifier_already_admitted");
    const evidence = duplicate.priorEvidence as { matches: Array<{ ownerEventId: string | null }> };
    assert.equal(evidence.matches.some((match) => match.ownerEventId === first.id), true);
    const recorded = await db.clientSheetsDedupeDecision.findUniqueOrThrow({
      where: { idempotencyKey: `sheets:${client.gate}:${second.id}` },
    });
    assert.equal(recorded.policy, SHEETS_PERSON_POLICY);
    assert.equal(recorded.channel, "sheets");
    assert.equal(recorded.reason, "normalized_identifier_already_admitted");
    assert.equal(recorded.normalizedPhone, normalizedPhone);

    const emailTwin = await makeLead({
      clientAccountId: client.gate,
      phone: phone(),
      email: mixedEmail,
      sourceProvider: "facebook",
      routeKey: "vendor-c",
    });
    const emailIdentity = await payloadIdentity(emailTwin.id);
    assert.equal(emailIdentity.email, firstIdentity.email);
    assert.notEqual(emailIdentity.phone, firstIdentity.phone);
    const emailDuplicate = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.gate,
      sourceLeadEventId: emailTwin.id,
    });
    assert.equal(emailDuplicate.code, "person_duplicate");
    assert.equal(emailDuplicate.reason, "normalized_identifier_already_admitted");

    const other = await makeLead({
      clientAccountId: client.other,
      phone: national,
      email: mixedEmail,
      sourceProvider: "manual_import",
    });
    const isolated = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.other,
      sourceLeadEventId: other.id,
    });
    assert.equal(isolated.code, "admitted");
    assert.equal(await db.clientSheetsPersonAdmission.count({ where: { normalizedValue: normalizedPhone } }), 2);
  });

  it("does not block on a shared name and holds a phone/email split for review", async () => {
    const leftPhone = phone();
    const rightPhone = phone();
    const left = await makeLead({
      clientAccountId: client.gate,
      phone: leftPhone,
      email: email("left"),
      name: "Ada Lovelace",
    });
    const right = await makeLead({
      clientAccountId: client.gate,
      phone: rightPhone,
      email: email("right"),
      name: "Ada Lovelace",
    });
    assert.equal((await evaluateClientSheetsPersonGate(db, { clientAccountId: client.gate, sourceLeadEventId: left.id })).code, "admitted");
    assert.equal((await evaluateClientSheetsPersonGate(db, { clientAccountId: client.gate, sourceLeadEventId: right.id })).code, "admitted");

    const rightEmail = (await payloadIdentity(right.id)).email;
    assert.ok(rightEmail);
    const namedOnly = await makeLead({
      clientAccountId: client.gate,
      phone: null,
      email: null,
      name: "Ada Lovelace",
    });
    const nameHeld = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.gate,
      sourceLeadEventId: namedOnly.id,
    });
    assert.equal(nameHeld.code, "person_review");
    assert.equal(nameHeld.reason, "no_normalized_phone_or_email");
    assert.equal(await db.clientSheetsPersonAdmission.count({ where: { sourceLeadEventId: namedOnly.id } }), 0);

    const split = await makeLead({
      clientAccountId: client.gate,
      phone: leftPhone,
      email: rightEmail,
      name: "Different Person",
    });
    const review = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.gate,
      sourceLeadEventId: split.id,
    });
    assert.equal(review.code, "person_review");
    assert.equal(review.reason, "shared_identifier_conflict");
    assert.equal(
      await db.clientSheetsPersonAdmission.count({ where: { sourceLeadEventId: split.id } }),
      0
    );
  });

  it("serializes concurrent matching submissions to one reservation", async () => {
    const shared = phone();
    const left = await makeLead({ clientAccountId: client.gate, phone: shared, email: email("race-left") });
    const right = await makeLead({ clientAccountId: client.gate, phone: shared, email: email("race-right") });
    const results = await Promise.all([
      db.$transaction((tx) =>
        evaluateClientSheetsPersonGate(tx, { clientAccountId: client.gate, sourceLeadEventId: left.id })
      ),
      db.$transaction((tx) =>
        evaluateClientSheetsPersonGate(tx, { clientAccountId: client.gate, sourceLeadEventId: right.id })
      ),
    ]);
    const codes = results.map((result) => result.code).sort();
    assert.deepEqual(codes, ["admitted", "person_duplicate"]);
    assert.equal(
      await db.clientSheetsPersonAdmission.count({ where: { clientAccountId: client.gate, normalizedValue: shared } }),
      1
    );
  });

  it("holds a missing or failed assessment and still allows the same lead's GHL outbox", async () => {
    const missingDecision = await makeDecision(null);
    const missingLead = await makeLead({
      clientAccountId: client.sheets,
      phone: phone(),
      email: email("missing"),
      decisionId: missingDecision.id,
    });
    await recordCompanySheetsCampaignIntent(
      {
        sourceLeadEventId: missingLead.id,
        status: "routing_matched",
        clientAccountId: client.sheets,
        resolvedAt: new Date(),
      },
      db,
      dispatchEnv
    );
    const missingIntent = await db.companySheetsDispatchIntent.findFirstOrThrow({
      where: { sourceLeadEventId: missingLead.id },
    });
    assert.equal(missingIntent.status, "assessment_held");
    assert.equal(missingIntent.reason, "assessment_missing");
    assert.equal(await db.clientSheetsPersonAdmission.count({ where: { sourceLeadEventId: missingLead.id } }), 0);
    await recordGhlAssociationDispatchOutbox(
      {
        sourceLeadEventId: missingLead.id,
        status: "routing_matched",
        routing: {
          matched: true,
          routingAuthority: ROUTING_AUTHORITY_SOURCE_ASSOCIATION,
          routingDryRunDecisionId: missingDecision.id,
          destinationClientAccountId: client.sheets,
          destinationLocationIdGhl: "loc_person_gate",
        },
        resolvedAt: new Date(),
      },
      db,
      dispatchEnv
    );
    const outbox = await db.ghlAssociationDispatchOutbox.findFirstOrThrow({
      where: { sourceLeadEventId: missingLead.id },
    });
    assert.equal(outbox.status, "pending");

    const failedDecision = await makeDecision(null);
    await recordDuplicateRiskAssessmentFailure(failedDecision.id, "Error");
    const failedLead = await makeLead({
      clientAccountId: client.sheets,
      phone: phone(),
      email: email("failed"),
      decisionId: failedDecision.id,
    });
    const failed = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.sheets,
      sourceLeadEventId: failedLead.id,
    });
    assert.equal(failed.code, "assessment_failed");
    assert.equal(failed.reason, "assessment_needs_review");
    assert.equal(failed.intentStatus, "assessment_failed");
    assert.equal(await db.ghlAssociationDispatchOutbox.count({ where: { sourceLeadEventId: failedLead.id } }), 0);
  });

  it("admits when an assessment is present and does not let Sheets success settle GHL", async () => {
    const decision = await makeDecision("none");
    const lead = await makeLead({
      clientAccountId: client.sheets,
      phone: phone(),
      email: email("present"),
      decisionId: decision.id,
    });
    await recordCompanySheetsCampaignIntent(
      {
        sourceLeadEventId: lead.id,
        status: "routing_matched",
        clientAccountId: client.sheets,
        resolvedAt: new Date(),
      },
      db,
      dispatchEnv
    );
    const intent = await db.companySheetsDispatchIntent.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
    assert.equal(intent.status, "pending");
    await recordGhlAssociationDispatchOutbox(
      {
        sourceLeadEventId: lead.id,
        status: "routing_matched",
        routing: {
          matched: true,
          routingAuthority: ROUTING_AUTHORITY_SOURCE_ASSOCIATION,
          destinationClientAccountId: client.sheets,
          destinationLocationIdGhl: "loc_person_gate",
        },
        resolvedAt: new Date(),
      },
      db,
      dispatchEnv
    );
    const queued = await enqueueConfirmedLeadSheetsDelivery(lead.id, { db, scheduleWithoutExecution: true });
    assert.equal(queued.ok, true);
    if (!queued.ok) return;
    await noteSheetsPersonDelivery(db, {
      clientAccountId: client.sheets,
      sourceLeadEventId: lead.id,
      jobId: queued.job.id,
      outcome: "succeeded",
      spreadsheetId: queued.job.spreadsheetId,
      worksheetId: queued.job.worksheetId,
    });
    const outbox = await db.ghlAssociationDispatchOutbox.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
    assert.equal(outbox.status, "pending");
    const admitted = await db.clientSheetsPersonAdmission.findFirstOrThrow({
      where: { sourceLeadEventId: lead.id, kind: "phone" },
    });
    assert.equal(admitted.status, "admitted");
    const repeated = await enqueueConfirmedLeadSheetsDelivery(lead.id, { db, scheduleWithoutExecution: true });
    assert.equal(repeated.ok, true);
    if (!repeated.ok) return;
    assert.equal(repeated.created, false);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: lead.id } }), 1);
  });

  it("retries a known pre-send failure and blocks a different event after an uncertain append", async () => {
    const decision = await makeDecision("possible_duplicate");
    const retryPhone = phone();
    const first = await makeLead({
      clientAccountId: client.sheets,
      phone: retryPhone,
      email: email("presend"),
      decisionId: decision.id,
    });
    const admitted = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.sheets,
      sourceLeadEventId: first.id,
    });
    assert.equal(admitted.code, "admitted");
    const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: client.sheets } });
    await db.companySheetsDeliveryJob.create({
      data: {
        kind: "lead",
        status: "failed",
        clientAccountId: client.sheets,
        companyConnectionId: connectionId,
        destinationId: destination.id,
        spreadsheetId: destination.spreadsheetId,
        spreadsheetUrl: destination.spreadsheetUrl,
        worksheetId: 0,
        worksheetTitle: "Campaign Leads",
        controlBasis: "drive_owner_verified",
        destinationUpdatedAt: destination.updatedAt,
        headerContract: [...COMPANY_SHEETS_LEAD_HEADER],
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
        idempotencyKey: `lead:${client.sheets}:${first.id}`,
        sourceLeadEventId: first.id,
        rowsTotal: 1,
        rowsWritten: 0,
        appendStartedAt: null,
      },
    });
    const replay = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.sheets,
      sourceLeadEventId: first.id,
    });
    assert.equal(replay.code, "replay_allowed");
    const other = await makeLead({
      clientAccountId: client.sheets,
      phone: retryPhone,
      email: email("presend-other"),
      decisionId: (await makeDecision("none")).id,
    });
    const blocked = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.sheets,
      sourceLeadEventId: other.id,
    });
    assert.equal(blocked.code, "person_duplicate");

    const uncertainPhone = phone();
    const uncertainDecision = await makeDecision("none");
    const uncertainLead = await makeLead({
      clientAccountId: client.sheets,
      phone: uncertainPhone,
      email: email("uncertain"),
      decisionId: uncertainDecision.id,
    });
    await db.companySheetsDeliveryJob.create({
      data: {
        kind: "lead",
        status: "uncertain",
        clientAccountId: client.sheets,
        companyConnectionId: connectionId,
        destinationId: destination.id,
        spreadsheetId: destination.spreadsheetId,
        spreadsheetUrl: destination.spreadsheetUrl,
        worksheetId: 3,
        worksheetTitle: "Old Tab",
        controlBasis: "drive_owner_verified",
        destinationUpdatedAt: destination.updatedAt,
        headerContract: [...COMPANY_SHEETS_LEAD_HEADER],
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
        idempotencyKey: `lead:${client.sheets}:${uncertainLead.id}:uncertain`,
        sourceLeadEventId: uncertainLead.id,
        rowsTotal: 1,
        rowsWritten: 0,
        appendStartedAt: new Date(),
        uncertainReason: "append_outcome_unknown",
      },
    });
    await db.companySheetsTabContract.update({
      where: { destinationId_role: { destinationId: destination.id, role: "campaign" } },
      data: { worksheetId: 9, worksheetTitle: "Replacement Tab" },
    });
    const afterTabChange = await makeLead({
      clientAccountId: client.sheets,
      phone: uncertainPhone,
      email: email("after-tab"),
      decisionId: (await makeDecision("none")).id,
    });
    const tabHeld = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.sheets,
      sourceLeadEventId: afterTabChange.id,
    });
    assert.equal(tabHeld.code, "person_duplicate");
    assert.equal(tabHeld.reason, "sheets_delivery_already_recorded");
    const prior = tabHeld.priorEvidence as { matches: Array<{ worksheetId: number | null }> };
    assert.equal(prior.matches.some((match) => match.worksheetId === 3), true);
    const reserved = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.sheets,
      sourceLeadEventId: uncertainLead.id,
    });
    assert.equal(reserved.code, "replay_allowed");
    const uncertainJob = await db.companySheetsDeliveryJob.findFirstOrThrow({
      where: { sourceLeadEventId: uncertainLead.id },
    });
    await noteSheetsPersonDelivery(db, {
      clientAccountId: client.sheets,
      sourceLeadEventId: uncertainLead.id,
      jobId: uncertainJob.id,
      outcome: "uncertain",
      spreadsheetId: destination.spreadsheetId,
      worksheetId: 3,
    });
    const slot = await db.clientSheetsPersonAdmission.findFirstOrThrow({
      where: { sourceLeadEventId: uncertainLead.id, kind: "phone" },
    });
    assert.equal(slot.status, "reserved");
    await db.companySheetsDeliveryJob.deleteMany({ where: { sourceLeadEventId: uncertainLead.id } });
    const stillHeld = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.sheets,
      sourceLeadEventId: afterTabChange.id,
    });
    assert.equal(stillHeld.code, "person_duplicate");
    assert.equal(stillHeld.reason, "sheets_delivery_already_recorded");
    const surviving = await db.clientSheetsPersonAdmission.findFirstOrThrow({
      where: { sourceLeadEventId: uncertainLead.id, kind: "phone" },
    });
    assert.equal(surviving.status, "reserved");
    assert.equal(surviving.origin, "delivery_index");
    await db.companySheetsTabContract.update({
      where: { destinationId_role: { destinationId: destination.id, role: "campaign" } },
      data: { worksheetId: 0, worksheetTitle: "Campaign Leads" },
    });
  });

  it("imports a verified zap baseline once and matches it without a live zap", async () => {
    const baselinePhone = phone();
    const first = await importVerifiedZapSheetsBaseline(db, {
      clientAccountId: client.gate,
      records: [
        {
          importKey: `zap-${suffix}-1`,
          phone: baselinePhone,
          email: `Zap.${suffix}@Example.com`,
          verifiedAt: "2026-01-15T00:00:00.000Z",
          evidenceRef: "zap-history:export-42",
        },
        {
          importKey: `zap-${suffix}-name`,
          name: "Name Only",
          verifiedAt: "2026-01-15T00:00:00.000Z",
          evidenceRef: "zap-history:name",
        },
        {
          importKey: `zap-${suffix}-blank`,
          phone: baselinePhone,
          verifiedAt: "not-a-date",
          evidenceRef: "",
        },
      ],
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.imported, 1);
    assert.equal(first.identifiersAdmitted, 2);
    assert.equal(first.skippedNameOnly, 1);
    assert.equal(first.skippedUnverified, 1);
    assert.equal(first.withEitherIdentifier, 2);
    const second = await importVerifiedZapSheetsBaseline(db, {
      clientAccountId: client.gate,
      records: [
        {
          importKey: `zap-${suffix}-1`,
          phone: baselinePhone,
          email: `zap.${suffix}@example.com`,
          verifiedAt: "2026-01-15T00:00:00.000Z",
          evidenceRef: "zap-history:export-42",
        },
        {
          importKey: `zap-${suffix}-conflict`,
          phone: baselinePhone,
          verifiedAt: "2026-02-01T00:00:00.000Z",
          evidenceRef: "zap-history:other",
        },
      ],
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.alreadyPresent, 1);
    assert.equal(second.conflicts, 1);
    assert.equal(second.imported, 0);
    const live = await makeLead({
      clientAccountId: client.gate,
      phone: baselinePhone,
      email: email("after-zap"),
    });
    const matched = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.gate,
      sourceLeadEventId: live.id,
    });
    assert.equal(matched.code, "person_duplicate");
    const evidence = matched.priorEvidence as { matches: Array<{ origin: string; historicalImportKey: string | null }> };
    assert.equal(evidence.matches.some((match) => match.origin === "historical_baseline"), true);
    assert.equal(await db.ghlAssociationDispatchOutbox.count({ where: { clientAccountId: client.gate } }), 0);
  });

  it("does not schedule when dispatch is off and blocks an assessment that already blocks live delivery", async () => {
    const quiet = await makeLead({ clientAccountId: client.sheets, phone: phone(), email: email("quiet") });
    await recordCompanySheetsCampaignIntent(
      {
        sourceLeadEventId: quiet.id,
        status: "routing_matched",
        clientAccountId: client.sheets,
        resolvedAt: new Date(),
      },
      db,
      { ...process.env, SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED: "false" }
    );
    assert.equal(await db.companySheetsDispatchIntent.count({ where: { sourceLeadEventId: quiet.id } }), 0);
    assert.equal(await db.clientSheetsDedupeDecision.count({ where: { sourceLeadEventId: quiet.id } }), 0);

    const blocking = await makeDecision("likely_duplicate");
    const blockedLead = await makeLead({
      clientAccountId: client.sheets,
      phone: phone(),
      email: email("likely"),
      decisionId: blocking.id,
    });
    const result = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.sheets,
      sourceLeadEventId: blockedLead.id,
    });
    assert.equal(result.reason, "assessment_blocks_live_delivery");
    assert.equal(await db.clientSheetsPersonAdmission.count({ where: { sourceLeadEventId: blockedLead.id } }), 0);

    const overridden = await makeDecision("likely_duplicate");
    await db.leadDuplicateRiskAssessment.update({
      where: { routingDryRunDecisionId: overridden.id },
      data: { operatorOverrideStatus: "separate_person" },
    });
    const released = await makeLead({
      clientAccountId: client.sheets,
      phone: phone(),
      email: email("separate"),
      decisionId: overridden.id,
    });
    const allowed = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.sheets,
      sourceLeadEventId: released.id,
    });
    assert.equal(allowed.code, "admitted");
  });

  it("holds a new person only while a history batch remains, then admits them when the cursor is exhausted", async () => {
    await db.clientSheetsHistoryCoverage.deleteMany({ where: { clientAccountId: client.other } });
    await db.companySheetsDeliveryJob.deleteMany({ where: { clientAccountId: client.other } });
    const matchPhone = phone();
    const destination = await db.companySheetsDestination.findUnique({ where: { clientAccountId: client.sheets } });
    if (!destination) throw new Error("destination missing");
    const planted: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const lead = await makeLead({
        clientAccountId: client.other,
        phone: index === 2 ? matchPhone : phone(),
        email: email(`hist-${index}`),
      });
      planted.push(lead.id);
      await db.companySheetsDeliveryJob.create({
        data: {
          kind: "lead",
          status: "succeeded",
          clientAccountId: client.other,
          companyConnectionId: connectionId,
          destinationId: destination.id,
          spreadsheetId: destination.spreadsheetId,
          spreadsheetUrl: destination.spreadsheetUrl,
          worksheetId: index + 1,
          worksheetTitle: `Hist ${index}`,
          controlBasis: "drive_owner_verified",
          destinationUpdatedAt: destination.updatedAt,
          headerContract: [...COMPANY_SHEETS_LEAD_HEADER],
          schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
          idempotencyKey: `lead:${client.other}:${lead.id}:hist`,
          sourceLeadEventId: lead.id,
          rowsTotal: 1,
          rowsWritten: 1,
          appendStartedAt: new Date(),
          createdAt: new Date(Date.UTC(2024, 0, index + 1)),
        },
      });
    }
    const unseen = await readClientSheetsHistoryCoverage(db, client.other);
    assert.equal(unseen.status, "unavailable");
    assert.equal(unseen.completenessProof, "not_started");
    const fresh = await makeLead({
      clientAccountId: client.other,
      phone: phone(),
      email: email("brand-new"),
    });
    const held = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.other,
      sourceLeadEventId: fresh.id,
      historyBatchSize: 2,
    });
    assert.equal(held.code, "person_review");
    assert.equal(held.reason, "history_coverage_partial");
    assert.equal(held.historyCoverage, "partial");
    assert.equal(await db.clientSheetsPersonAdmission.count({ where: { sourceLeadEventId: fresh.id } }), 0);
    await db.clientSheetsHistoryCoverage.update({
      where: { clientAccountId: client.other },
      data: { indexedCount: 999 },
    });
    const inflated = await readClientSheetsHistoryCoverage(db, client.other);
    assert.equal(inflated.indexedCount, 999);
    assert.equal(inflated.status, "partial");
    assert.notEqual(inflated.completenessProof, "cursor_exhausted");
    const duplicate = await makeLead({
      clientAccountId: client.other,
      phone: matchPhone,
      email: email("late-match"),
    });
    const stillUnproven = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.other,
      sourceLeadEventId: duplicate.id,
      historyBatchSize: 2,
    });
    assert.notEqual(stillUnproven.code, "admitted");
    const finished = await prepareClientSheetsHistoryBaseline(db, { clientAccountId: client.other, batchSize: 2 });
    assert.equal(finished.status, "complete");
    assert.equal(finished.completenessProof, "cursor_exhausted");
    const blocked = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.other,
      sourceLeadEventId: duplicate.id,
    });
    assert.equal(blocked.code, "person_duplicate");
    const admitted = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.other,
      sourceLeadEventId: fresh.id,
    });
    assert.equal(admitted.code, "admitted");
    assert.equal(admitted.historyCoverage, "complete");
    void planted;
  });

  it("retries a transient assessment through the drain and lets an operator release a review hold", async () => {
    const drainEnv = {
      ...dispatchEnv,
      SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: "false",
    };
    const parkOtherDueIntents = async (exceptId: string) => {
      await db.companySheetsDispatchIntent.updateMany({
        where: {
          id: { not: exceptId },
          status: { in: ["pending", "scheduled", "retryable", "processing", "awaiting_setup"] },
        },
        data: { status: "completed", reason: "test_isolation" },
      });
      await db.companySheetsDispatchIntent.updateMany({
        where: {
          id: { not: exceptId },
          status: { in: ["assessment_failed", "review_held"] },
        },
        data: { availableAt: new Date("2099-01-01T00:00:00.000Z") },
      });
    };
    const transientDecision = await makeDecision(null);
    await recordDuplicateRiskAssessmentFailure(transientDecision.id, "TimeoutError", "transient");
    const transientPhone = phone();
    const transientLead = await makeLead({
      clientAccountId: client.sheets,
      phone: transientPhone,
      email: email("transient"),
      decisionId: transientDecision.id,
    });
    await db.sourceLeadEvent.update({
      where: { id: transientLead.id },
      data: {
        rawPayloadJson: {
          schema_version: "1.0",
          client_account_id: client.sheets,
          contact: {
            lead_uid: `lead_${suffix}_transient`,
            first_name: "Ada",
            last_name: "Lovelace",
            phone_e164: transientPhone,
            email: `transient.${suffix}@example.com`,
          },
          state: {},
          event: {
            event_uuid: `evt_${suffix}_transient`,
            event_name_internal: "lead_created",
            event_name_meta: "Lead",
            send_to_meta: false,
          },
        },
      },
    });
    await recordCompanySheetsCampaignIntent(
      {
        sourceLeadEventId: transientLead.id,
        status: "routing_matched",
        clientAccountId: client.sheets,
        resolvedAt: new Date(),
      },
      db,
      dispatchEnv
    );
    const held = await db.companySheetsDispatchIntent.findFirstOrThrow({ where: { sourceLeadEventId: transientLead.id } });
    assert.equal(held.status, "assessment_failed");
    assert.equal(held.reason, "assessment_failed_transient");
    await parkOtherDueIntents(held.id);
    const firstDrain = await processDueCompanySheetsDispatches({ db, env: drainEnv, now: () => new Date() });
    assert.ok(firstDrain.processed >= 1);
    const promoted = await db.companySheetsDispatchIntent.findUniqueOrThrow({ where: { id: held.id } });
    assert.equal(promoted.status, "scheduled");
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: transientLead.id } }), 1);
    assert.equal(await db.ghlAssociationDispatchOutbox.count({ where: { sourceLeadEventId: transientLead.id } }), 0);
    assert.equal(await db.leadDuplicateRiskAssessment.count({ where: { routingDryRunDecisionId: transientDecision.id } }), 1);
    const secondDrain = await processDueCompanySheetsDispatches({ db, env: drainEnv, now: () => new Date() });
    void secondDrain;
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: transientLead.id } }), 1);
    assert.equal(await db.companySheetsDispatchIntent.count({ where: { sourceLeadEventId: transientLead.id } }), 1);

    const reviewDecision = await makeDecision(null);
    await recordDuplicateRiskAssessmentFailure(reviewDecision.id, "Error", "review");
    const reviewLead = await makeLead({
      clientAccountId: client.sheets,
      phone: phone(),
      email: email("review-assess"),
      decisionId: reviewDecision.id,
    });
    await recordCompanySheetsCampaignIntent(
      {
        sourceLeadEventId: reviewLead.id,
        status: "routing_matched",
        clientAccountId: client.sheets,
        resolvedAt: new Date(),
      },
      db,
      dispatchEnv
    );
    const reviewIntent = await db.companySheetsDispatchIntent.findFirstOrThrow({ where: { sourceLeadEventId: reviewLead.id } });
    assert.equal(reviewIntent.reason, "assessment_needs_review");
    await processDueCompanySheetsDispatches({ db, env: drainEnv, now: () => new Date() });
    const untouched = await db.companySheetsDispatchIntent.findUniqueOrThrow({ where: { id: reviewIntent.id } });
    assert.equal(untouched.status, "assessment_failed");
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: reviewLead.id } }), 0);
    const refused = await recoverClientSheetsPersonHold(db, reviewLead.id, "operator");
    assert.equal(refused.ok, true);
    if (!refused.ok) return;
    assert.equal(refused.promoted, false);
    assert.equal(refused.reason, "assessment_needs_review");
    await db.leadDuplicateRiskAssessment.create({
      data: {
        masterClientAccountId: client.sheets,
        routingDryRunDecisionId: reviewDecision.id,
        riskLevel: "none",
        identityStatus: "linked",
        sourceLeadUid: `uid_review_${suffix}`,
      },
    });
    const released = await recoverClientSheetsPersonHold(db, reviewLead.id, "operator");
    assert.equal(released.ok, true);
    if (!released.ok) return;
    assert.equal(released.promoted, true);
    assert.equal(released.status, "pending");
    const again = await recoverClientSheetsPersonHold(db, reviewLead.id, "operator");
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.promoted, false);
    await processDueCompanySheetsDispatches({ db, env: drainEnv, now: () => new Date() });
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: reviewLead.id } }), 1);
    await processDueCompanySheetsDispatches({ db, env: drainEnv, now: () => new Date() });
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: reviewLead.id } }), 1);
    assert.equal(await db.ghlAssociationDispatchOutbox.count({ where: { sourceLeadEventId: reviewLead.id } }), 0);

    const heldDecision = await makeDecision(null);
    const heldLead = await makeLead({
      clientAccountId: client.sheets,
      phone: phone(),
      email: email("assessment-held"),
      decisionId: heldDecision.id,
    });
    await recordCompanySheetsCampaignIntent(
      {
        sourceLeadEventId: heldLead.id,
        status: "routing_matched",
        clientAccountId: client.sheets,
        resolvedAt: new Date(),
      },
      db,
      dispatchEnv
    );
    const heldIntent = await db.companySheetsDispatchIntent.findFirstOrThrow({
      where: { sourceLeadEventId: heldLead.id },
    });
    assert.equal(heldIntent.status, "assessment_held");
    assert.equal(heldIntent.reason, "assessment_missing");
    await processDueCompanySheetsDispatches({ db, env: drainEnv, now: () => new Date() });
    const stillHeld = await db.companySheetsDispatchIntent.findUniqueOrThrow({ where: { id: heldIntent.id } });
    assert.equal(stillHeld.status, "assessment_held");
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: heldLead.id } }), 0);
    await db.leadDuplicateRiskAssessment.create({
      data: {
        masterClientAccountId: client.sheets,
        routingDryRunDecisionId: heldDecision.id,
        riskLevel: "none",
        identityStatus: "linked",
        sourceLeadUid: `uid_held_${suffix}`,
      },
    });
    const promotedHeld = await recoverClientSheetsPersonHold(db, heldLead.id, "operator");
    assert.equal(promotedHeld.ok, true);
    if (!promotedHeld.ok) return;
    assert.equal(promotedHeld.promoted, true);
    assert.equal(promotedHeld.status, "pending");
    await processDueCompanySheetsDispatches({ db, env: drainEnv, now: () => new Date() });
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: heldLead.id } }), 1);
    await processDueCompanySheetsDispatches({ db, env: drainEnv, now: () => new Date() });
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: heldLead.id } }), 1);
    assert.equal(await db.ghlAssociationDispatchOutbox.count({ where: { sourceLeadEventId: heldLead.id } }), 0);
  });

  it("releases a known-dead reservation under the client lock and refuses an uncertain append", async () => {
    const shared = phone();
    const ownerLead = await makeLead({ clientAccountId: client.gate, phone: shared, email: email("dead-owner") });
    const reserved = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.gate,
      sourceLeadEventId: ownerLead.id,
    });
    assert.equal(reserved.code, "admitted");
    const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: client.sheets } });
    await db.companySheetsDeliveryJob.create({
      data: {
        kind: "lead",
        status: "failed",
        clientAccountId: client.gate,
        companyConnectionId: connectionId,
        destinationId: destination.id,
        spreadsheetId: destination.spreadsheetId,
        spreadsheetUrl: destination.spreadsheetUrl,
        worksheetId: 0,
        worksheetTitle: "Campaign Leads",
        controlBasis: "drive_owner_verified",
        destinationUpdatedAt: destination.updatedAt,
        headerContract: [...COMPANY_SHEETS_LEAD_HEADER],
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
        idempotencyKey: `lead:${client.gate}:${ownerLead.id}`,
        sourceLeadEventId: ownerLead.id,
        rowsTotal: 1,
        rowsWritten: 0,
        appendStartedAt: null,
      },
    });
    const challenger = await makeLead({ clientAccountId: client.gate, phone: shared, email: email("dead-challenger") });
    const [released, raced] = await Promise.all([
      db.$transaction((tx) =>
        releaseKnownDeadSheetsPersonReservation(tx, {
          clientAccountId: client.gate,
          sourceLeadEventId: ownerLead.id,
          actor: "operator",
        })
      ),
      db.$transaction((tx) =>
        evaluateClientSheetsPersonGate(tx, { clientAccountId: client.gate, sourceLeadEventId: challenger.id })
      ),
    ]);
    assert.equal(released.ok, true);
    const active = await db.clientSheetsPersonAdmission.count({
      where: { clientAccountId: client.gate, normalizedValue: shared, status: { in: ["reserved", "admitted"] } },
    });
    assert.ok(active <= 1);
    const follow = raced.code === "admitted" ? raced : await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.gate,
      sourceLeadEventId: challenger.id,
    });
    assert.equal(follow.code, "admitted");
    assert.equal(
      await db.clientSheetsPersonAdmission.count({
        where: { clientAccountId: client.gate, normalizedValue: shared, sourceLeadEventId: challenger.id },
      }),
      1
    );
    assert.equal(await db.clientSheetsPersonRelease.count({ where: { sourceLeadEventId: ownerLead.id } }), 2);
    const audit = await db.clientSheetsDedupeDecision.findUniqueOrThrow({
      where: { idempotencyKey: `sheets:${client.gate}:${ownerLead.id}` },
    });
    assert.equal(audit.reason, "known_dead_presend_released");

    const uncertainOwner = await makeLead({ clientAccountId: client.gate, phone: phone(), email: email("uncertain-owner") });
    await evaluateClientSheetsPersonGate(db, { clientAccountId: client.gate, sourceLeadEventId: uncertainOwner.id });
    await db.companySheetsDeliveryJob.create({
      data: {
        kind: "lead",
        status: "uncertain",
        clientAccountId: client.gate,
        companyConnectionId: connectionId,
        destinationId: destination.id,
        spreadsheetId: destination.spreadsheetId,
        spreadsheetUrl: destination.spreadsheetUrl,
        worksheetId: 4,
        worksheetTitle: "Open",
        controlBasis: "drive_owner_verified",
        destinationUpdatedAt: destination.updatedAt,
        headerContract: [...COMPANY_SHEETS_LEAD_HEADER],
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
        idempotencyKey: `lead:${client.gate}:${uncertainOwner.id}:uncertain`,
        sourceLeadEventId: uncertainOwner.id,
        rowsTotal: 1,
        rowsWritten: 0,
        appendStartedAt: new Date(),
        uncertainReason: "append_outcome_unknown",
      },
    });
    const refused = await releaseKnownDeadSheetsPersonReservation(db, {
      clientAccountId: client.gate,
      sourceLeadEventId: uncertainOwner.id,
    });
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.code, "uncertain_append_held");
    assert.equal(
      await db.clientSheetsPersonAdmission.count({ where: { sourceLeadEventId: uncertainOwner.id, status: "reserved" } }),
      2
    );
  });

  it("plans a quarantine for queued lead jobs that have no admission and leaves them untouched", async () => {
    const queuedLead = await makeLead({ clientAccountId: client.other, phone: phone(), email: email("queued-old") });
    const destination = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: client.sheets } });
    const job = await db.companySheetsDeliveryJob.create({
      data: {
        kind: "lead",
        status: "queued",
        clientAccountId: client.other,
        companyConnectionId: connectionId,
        destinationId: destination.id,
        spreadsheetId: destination.spreadsheetId,
        spreadsheetUrl: destination.spreadsheetUrl,
        worksheetId: 0,
        worksheetTitle: "Campaign Leads",
        controlBasis: "drive_owner_verified",
        destinationUpdatedAt: destination.updatedAt,
        headerContract: [...COMPANY_SHEETS_LEAD_HEADER],
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
        idempotencyKey: `lead:${client.other}:${queuedLead.id}:pre`,
        sourceLeadEventId: queuedLead.id,
        rowsTotal: 1,
        rowsWritten: 0,
      },
    });
    const plan = await planPreMigrationLeadJobQuarantine(db, client.other);
    assert.equal(plan.ran, false);
    assert.equal(plan.strategy, "quarantine_until_reconciled");
    assert.equal(plan.jobs.some((row) => row.jobId === job.id && row.reason === "no_person_admission"), true);
    const stored = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(stored.status, "queued");
    const pilot = await makeLead({
      clientAccountId: client.other,
      phone: phone(),
      email: email("pilot"),
      routeKey: COMPANY_SHEETS_PILOT_ROUTE_KEY,
    });
    const exempt = await evaluateClientSheetsPersonGate(db, {
      clientAccountId: client.other,
      sourceLeadEventId: pilot.id,
    });
    assert.equal(exempt.code, "exempt_synthetic_pilot");
    assert.equal(await db.clientSheetsPersonAdmission.count({ where: { sourceLeadEventId: pilot.id } }), 0);
  });
});
