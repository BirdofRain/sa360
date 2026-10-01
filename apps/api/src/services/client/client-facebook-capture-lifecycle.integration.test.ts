import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { buildClientRekeyConfirmationPhrase } from "@sa360/shared";
import { prisma } from "../../lib/db.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { isFacebookCaptureIntakeEnabled } from "../source-intake/facebook-capture-gate.js";
import {
  ENRICHMENT_ASSOCIATION_CLIENT_FIELD,
  NORMALIZED_ASSOCIATION_CLIENT_FIELD,
  summarizeInconsistentAssociationSnapshots,
} from "./client-association-snapshot.js";
import { deleteClientAdmin, getClientDeletionImpact } from "../client-account.service.js";
import {
  summarizeSourceFunnelClientReferences,
} from "./client-deletion-impact.service.js";
import {
  SOURCE_FUNNEL_ORIGIN_REFERENCE_KEY,
  SOURCE_FUNNEL_SUGGESTED_REFERENCE_KEY,
  SOURCE_LEAD_RESOLVED_REFERENCE_KEY,
} from "./client-rekey-references.js";
import {
  ClientRekeyConflictError,
  executeClientIdentityRekey,
  previewClientIdentityRekey,
} from "./client-rekey.service.js";

test("a SourceFunnel row that names the client in both fields is one affected row", () => {
  const summary = summarizeSourceFunnelClientReferences("client_a", [
    {
      id: "both",
      originClientAccountId: "client_a",
      suggestedClientAccountId: "client_a",
    },
    {
      id: "origin",
      originClientAccountId: "client_a",
      suggestedClientAccountId: "client_b",
    },
    {
      id: "suggested",
      originClientAccountId: null,
      suggestedClientAccountId: "client_a",
    },
    {
      id: "other",
      originClientAccountId: "client_b",
      suggestedClientAccountId: "client_b",
    },
  ]);
  assert.equal(summary.originReferences, 2);
  assert.equal(summary.suggestedReferences, 2);
  assert.equal(summary.affectedRows.length, 3);
  assert.deepEqual(
    summary.affectedRows.find((row) => row.id === "both")?.referencedFields,
    ["originClientAccountId", "suggestedClientAccountId"]
  );
  assert.equal(summary.affectedRows.filter((row) => row.id === "both").length, 1);
});

test("an event whose current snapshots both name the client is one inconsistent row", () => {
  const summary = summarizeInconsistentAssociationSnapshots("client_a", [
    {
      id: "both",
      clientAccountIdResolved: null,
      enrichmentClientAccountId: "client_a",
      normalizedClientAccountId: "client_a",
    },
    {
      id: "aligned",
      clientAccountIdResolved: "client_a",
      enrichmentClientAccountId: "client_a",
      normalizedClientAccountId: "client_a",
    },
    {
      id: "enrichment_only",
      clientAccountIdResolved: "client_b",
      enrichmentClientAccountId: "client_a",
      normalizedClientAccountId: "client_b",
    },
  ]);
  assert.equal(summary.enrichmentReferences, 2);
  assert.equal(summary.normalizedReferences, 1);
  assert.equal(summary.rows.length, 2);
  assert.deepEqual(summary.rows.find((row) => row.id === "both")?.referencedFields, [
    ENRICHMENT_ASSOCIATION_CLIENT_FIELD,
    NORMALIZED_ASSOCIATION_CLIENT_FIELD,
  ]);
  assert.equal(summary.rows.some((row) => row.id === "aligned"), false);
});

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function auditHistory(sourceId: string): Prisma.InputJsonArray {
  return [
    {
      at: "2026-01-01T00:00:00.000Z",
      action: "reevaluate_association",
      previous: {
        clientAccountIdResolved: sourceId,
        associationOutcome: "unassociated",
      },
      next: {
        outcome: "associated",
        clientAccountId: sourceId,
      },
    },
    {
      at: "2026-01-02T00:00:00.000Z",
      action: "reevaluate_association",
      previous: {
        clientAccountIdResolved: "historical_other",
        associationOutcome: "associated",
      },
      next: {
        outcome: "associated",
        clientAccountId: "historical_other",
      },
    },
  ];
}

function enrichment(input: {
  clientAccountId: string | null;
  explanation: string;
  audit: Prisma.InputJsonArray;
}): Prisma.InputJsonObject {
  return {
    captureOnly: true,
    captureSettled: true,
    intakeStage: "capture_only",
    association: {
      outcome: input.clientAccountId ? "associated" : "unassociated",
      clientAccountId: input.clientAccountId,
      sourceFunnelId: "funnel_historical",
      pageId: "123456789012345",
      formId: "223456789012345",
      explanation: input.explanation,
    },
    associationAudit: input.audit,
  };
}

function normalized(clientAccountId: string | null): Prisma.InputJsonObject {
  return {
    schema_version: "sa360.facebook_capture.v1",
    contact: { first_name: "Sam" },
    association: {
      outcome: clientAccountId ? "associated" : "unassociated",
      client_account_id: clientAccountId,
      source_funnel_id: "funnel_historical",
      page_id: "123456789012345",
      form_id: "223456789012345",
    },
  };
}

test("rekey migrates SourceFunnel ownership and current snapshots without rewriting audit history", async () => {
  const captureFlag = process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED;
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const stamp = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const sourceId = `fb_life_source_${stamp}`;
  const targetId = `fb_life_target_${stamp}`;
  const keeperId = `fb_life_keeper_${stamp}`;
  const locationId = `fb_life_location_${stamp}`;
  const eventIds: string[] = [];
  const funnelIds: string[] = [];
  const explanation = `captured for ${sourceId}`;
  const alignedAudit = auditHistory(sourceId);
  const unrelatedAudit = auditHistory(sourceId);

  try {
    await prisma.clientAccount.create({
      data: {
        clientAccountId: sourceId,
        clientDisplayName: "Capture lifecycle source",
        ghlDestination: {
          create: {
            destinationSubaccountIdGhl: locationId,
            ghlConnectionStatus: "connected",
          },
        },
      },
    });
    await prisma.clientAccount.create({
      data: { clientAccountId: keeperId, clientDisplayName: "Capture lifecycle keeper" },
    });
    await prisma.ghlLocationConnection.create({
      data: {
        clientAccountId: sourceId,
        locationId,
        accessTokenEncrypted: "isolated-test-access-token",
        refreshTokenEncrypted: "isolated-test-refresh-token",
        tokenExpiresAt: new Date(Date.now() + 60_000),
        connectionStatus: "connected",
      },
    });
    const dual = await prisma.sourceFunnel.create({
      data: {
        provider: "facebook",
        providerFunnelId: `fb-life-dual-${stamp}`,
        associationStatus: "confirmed",
        originClientAccountId: sourceId,
        suggestedClientAccountId: sourceId,
      },
    });
    const originOnly = await prisma.sourceFunnel.create({
      data: {
        provider: "facebook",
        providerFunnelId: `fb-life-origin-${stamp}`,
        associationStatus: "confirmed",
        originClientAccountId: sourceId,
        suggestedClientAccountId: keeperId,
      },
    });
    const suggestedOnly = await prisma.sourceFunnel.create({
      data: {
        provider: "facebook",
        providerFunnelId: `fb-life-suggested-${stamp}`,
        associationStatus: "suggested",
        originClientAccountId: null,
        suggestedClientAccountId: sourceId,
      },
    });
    const unrelatedFunnel = await prisma.sourceFunnel.create({
      data: {
        provider: "facebook",
        providerFunnelId: `fb-life-unrelated-${stamp}`,
        associationStatus: "confirmed",
        originClientAccountId: keeperId,
        suggestedClientAccountId: keeperId,
      },
    });
    funnelIds.push(dual.id, originOnly.id, suggestedOnly.id, unrelatedFunnel.id);

    const aligned = await prisma.sourceLeadEvent.create({
      data: {
        sourceProvider: "facebook",
        sourceSystem: "meta_lead_ads",
        sourceType: "lead_form",
        sourceLeadId: `aligned_${stamp}`,
        clientAccountIdResolved: sourceId,
        status: "normalized",
        rawPayloadJson: { leadgen_id: `aligned_${stamp}` },
        normalizedPayloadJson: normalized(sourceId),
        enrichmentMetadataJson: enrichment({
          clientAccountId: sourceId,
          explanation,
          audit: alignedAudit,
        }),
      },
    });
    const partial = await prisma.sourceLeadEvent.create({
      data: {
        sourceProvider: "facebook",
        sourceSystem: "meta_lead_ads",
        sourceType: "lead_form",
        sourceLeadId: `partial_${stamp}`,
        clientAccountIdResolved: sourceId,
        status: "normalized",
        rawPayloadJson: { leadgen_id: `partial_${stamp}` },
        normalizedPayloadJson: normalized(keeperId),
        enrichmentMetadataJson: enrichment({
          clientAccountId: sourceId,
          explanation: "partial snapshot",
          audit: auditHistory("partial_historical"),
        }),
      },
    });
    const unrelated = await prisma.sourceLeadEvent.create({
      data: {
        sourceProvider: "facebook",
        sourceSystem: "meta_lead_ads",
        sourceType: "lead_form",
        sourceLeadId: `unrelated_${stamp}`,
        clientAccountIdResolved: keeperId,
        status: "normalized",
        rawPayloadJson: { leadgen_id: `unrelated_${stamp}` },
        normalizedPayloadJson: normalized(keeperId),
        enrichmentMetadataJson: enrichment({
          clientAccountId: keeperId,
          explanation: "keeper snapshot",
          audit: unrelatedAudit,
        }),
      },
    });
    eventIds.push(aligned.id, partial.id, unrelated.id);
    const unrelatedBefore = await prisma.sourceLeadEvent.findUniqueOrThrow({
      where: { id: unrelated.id },
    });

    const preview = await previewClientIdentityRekey(sourceId, targetId);
    assert.equal(preview.safeToExecute, true);
    assert.equal(preview.references[SOURCE_FUNNEL_ORIGIN_REFERENCE_KEY], 2);
    assert.equal(preview.references[SOURCE_FUNNEL_SUGGESTED_REFERENCE_KEY], 2);
    assert.equal(preview.references[ENRICHMENT_ASSOCIATION_CLIENT_FIELD], 2);
    assert.equal(preview.references[NORMALIZED_ASSOCIATION_CLIENT_FIELD], 1);
    assert.equal(preview.references[SOURCE_LEAD_RESOLVED_REFERENCE_KEY], 2);

    const result = await executeClientIdentityRekey({
      sourceClientAccountId: sourceId,
      targetClientAccountId: targetId,
      confirmation: buildClientRekeyConfirmationPhrase(sourceId, targetId),
    });
    assert.equal(result.sourceRemoved, true);
    assert.equal(result.movedReferences[SOURCE_FUNNEL_ORIGIN_REFERENCE_KEY], 2);
    assert.equal(result.movedReferences[SOURCE_FUNNEL_SUGGESTED_REFERENCE_KEY], 2);
    assert.equal(result.movedReferences[ENRICHMENT_ASSOCIATION_CLIENT_FIELD], 2);
    assert.equal(result.movedReferences[NORMALIZED_ASSOCIATION_CLIENT_FIELD], 1);
    assert.equal(result.movedReferences[SOURCE_LEAD_RESOLVED_REFERENCE_KEY], 2);

    const dualAfter = await prisma.sourceFunnel.findUniqueOrThrow({ where: { id: dual.id } });
    assert.equal(dualAfter.originClientAccountId, targetId);
    assert.equal(dualAfter.suggestedClientAccountId, targetId);
    const originAfter = await prisma.sourceFunnel.findUniqueOrThrow({ where: { id: originOnly.id } });
    assert.equal(originAfter.originClientAccountId, targetId);
    assert.equal(originAfter.suggestedClientAccountId, keeperId);
    const suggestedAfter = await prisma.sourceFunnel.findUniqueOrThrow({
      where: { id: suggestedOnly.id },
    });
    assert.equal(suggestedAfter.originClientAccountId, null);
    assert.equal(suggestedAfter.suggestedClientAccountId, targetId);
    const unrelatedFunnelAfter = await prisma.sourceFunnel.findUniqueOrThrow({
      where: { id: unrelatedFunnel.id },
    });
    assert.equal(unrelatedFunnelAfter.originClientAccountId, keeperId);
    assert.equal(unrelatedFunnelAfter.suggestedClientAccountId, keeperId);

    const alignedAfter = await prisma.sourceLeadEvent.findUniqueOrThrow({ where: { id: aligned.id } });
    assert.equal(alignedAfter.clientAccountIdResolved, targetId);
    const alignedEnrichment = asRecord(alignedAfter.enrichmentMetadataJson);
    const alignedAssociation = asRecord(alignedEnrichment?.association);
    assert.equal(alignedAssociation?.clientAccountId, targetId);
    assert.equal(alignedAssociation?.explanation, explanation);
    assert.equal(alignedAssociation?.outcome, "associated");
    assert.deepEqual(alignedEnrichment?.associationAudit, alignedAudit);
    assert.equal(alignedEnrichment?.captureOnly, true);
    const alignedNormalized = asRecord(asRecord(alignedAfter.normalizedPayloadJson)?.association);
    assert.equal(alignedNormalized?.client_account_id, targetId);
    assert.equal(asRecord(alignedAfter.normalizedPayloadJson)?.schema_version, "sa360.facebook_capture.v1");
    assert.equal(asRecord(asRecord(alignedAfter.normalizedPayloadJson)?.contact)?.first_name, "Sam");

    const partialAfter = await prisma.sourceLeadEvent.findUniqueOrThrow({ where: { id: partial.id } });
    assert.equal(partialAfter.clientAccountIdResolved, targetId);
    assert.equal(
      asRecord(asRecord(partialAfter.enrichmentMetadataJson)?.association)?.clientAccountId,
      targetId
    );
    assert.equal(
      asRecord(asRecord(partialAfter.normalizedPayloadJson)?.association)?.client_account_id,
      keeperId
    );
    assert.deepEqual(
      asRecord(partialAfter.enrichmentMetadataJson)?.associationAudit,
      auditHistory("partial_historical")
    );

    const unrelatedAfter = await prisma.sourceLeadEvent.findUniqueOrThrow({
      where: { id: unrelated.id },
    });
    assert.equal(unrelatedAfter.clientAccountIdResolved, keeperId);
    assert.deepEqual(unrelatedAfter.enrichmentMetadataJson, unrelatedBefore.enrichmentMetadataJson);
    assert.deepEqual(unrelatedAfter.normalizedPayloadJson, unrelatedBefore.normalizedPayloadJson);
    assert.equal(process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED, captureFlag);
    if ((captureFlag ?? "").trim().toLowerCase() !== "true") {
      assert.equal(isFacebookCaptureIntakeEnabled(), false);
    }
  } finally {
    if (eventIds.length > 0) {
      await prisma.sourceLeadEvent.deleteMany({ where: { id: { in: eventIds } } });
    }
    if (funnelIds.length > 0) {
      await prisma.sourceFunnel.deleteMany({ where: { id: { in: funnelIds } } });
    }
    await prisma.ghlLocationConnection.deleteMany({ where: { locationId } });
    await prisma.clientAccount.deleteMany({
      where: { clientAccountId: { in: [sourceId, targetId, keeperId] } },
    });
  }
});

test("rekey refuses a current snapshot that names the source client on a different association", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const stamp = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const sourceId = `fb_life_dangling_source_${stamp}`;
  const targetId = `fb_life_dangling_target_${stamp}`;
  const keeperId = `fb_life_dangling_keeper_${stamp}`;
  const audit = auditHistory(sourceId);
  let eventId = "";
  try {
    await prisma.clientAccount.create({
      data: { clientAccountId: sourceId, clientDisplayName: "Dangling source" },
    });
    await prisma.clientAccount.create({
      data: { clientAccountId: keeperId, clientDisplayName: "Dangling keeper" },
    });
    const event = await prisma.sourceLeadEvent.create({
      data: {
        sourceProvider: "facebook",
        sourceSystem: "meta_lead_ads",
        sourceType: "lead_form",
        sourceLeadId: `dangling_${stamp}`,
        clientAccountIdResolved: keeperId,
        status: "normalized",
        rawPayloadJson: { leadgen_id: `dangling_${stamp}` },
        normalizedPayloadJson: normalized(sourceId),
        enrichmentMetadataJson: enrichment({
          clientAccountId: sourceId,
          explanation: "dangling snapshot",
          audit,
        }),
      },
    });
    eventId = event.id;
    const preview = await previewClientIdentityRekey(sourceId, targetId);
    assert.equal(preview.safeToExecute, false);
    assert.match(preview.conflicts.join(" "), /association snapshot/i);
    await assert.rejects(
      () =>
        executeClientIdentityRekey({
          sourceClientAccountId: sourceId,
          targetClientAccountId: targetId,
          confirmation: buildClientRekeyConfirmationPhrase(sourceId, targetId),
        }),
      (error: unknown) => error instanceof ClientRekeyConflictError
    );
    const stored = await prisma.sourceLeadEvent.findUniqueOrThrow({ where: { id: event.id } });
    assert.equal(stored.clientAccountIdResolved, keeperId);
    assert.equal(
      asRecord(asRecord(stored.enrichmentMetadataJson)?.association)?.clientAccountId,
      sourceId
    );
    assert.equal(
      asRecord(asRecord(stored.normalizedPayloadJson)?.association)?.client_account_id,
      sourceId
    );
    assert.deepEqual(asRecord(stored.enrichmentMetadataJson)?.associationAudit, audit);
    assert.equal(
      await prisma.clientAccount.count({ where: { clientAccountId: sourceId } }),
      1
    );
    assert.equal(
      await prisma.clientAccount.count({ where: { clientAccountId: targetId } }),
      0
    );
  } finally {
    if (eventId) {
      await prisma.sourceLeadEvent.deleteMany({ where: { id: eventId } });
    }
    await prisma.clientAccount.deleteMany({
      where: { clientAccountId: { in: [sourceId, targetId, keeperId] } },
    });
  }
});

test("deletion impact counts both SourceFunnel fields once per row and blocks inconsistent snapshots", async () => {
  const captureFlag = process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED;
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const stamp = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const clientId = `fb_life_delete_${stamp}`;
  const emptyId = `fb_life_empty_${stamp}`;
  const portalId = `fb_life_portal_${stamp}`;
  const funnelIds: string[] = [];
  const eventIds: string[] = [];
  const inconsistentAudit = auditHistory(clientId);

  await prisma.clientAccount.create({
    data: { clientAccountId: clientId, clientDisplayName: "Deletion lifecycle" },
  });
  await prisma.clientAccount.create({
    data: { clientAccountId: emptyId, clientDisplayName: "Empty lifecycle" },
  });
  await prisma.clientAccount.create({
    data: {
      clientAccountId: portalId,
      clientDisplayName: "Portal lifecycle",
      portalEnabled: true,
    },
  });

  try {
    const dual = await prisma.sourceFunnel.create({
      data: {
        provider: "facebook",
        providerFunnelId: `fb-del-dual-${stamp}`,
        associationStatus: "confirmed",
        originClientAccountId: clientId,
        suggestedClientAccountId: clientId,
      },
    });
    const originOnly = await prisma.sourceFunnel.create({
      data: {
        provider: "facebook",
        providerFunnelId: `fb-del-origin-${stamp}`,
        associationStatus: "confirmed",
        originClientAccountId: clientId,
      },
    });
    const suggestedOnly = await prisma.sourceFunnel.create({
      data: {
        provider: "facebook",
        providerFunnelId: `fb-del-suggested-${stamp}`,
        associationStatus: "suggested",
        suggestedClientAccountId: clientId,
      },
    });
    funnelIds.push(dual.id, originOnly.id, suggestedOnly.id);

    const aligned = await prisma.sourceLeadEvent.create({
      data: {
        sourceProvider: "facebook",
        sourceSystem: "meta_lead_ads",
        sourceType: "lead_form",
        sourceLeadId: `aligned_del_${stamp}`,
        clientAccountIdResolved: clientId,
        status: "normalized",
        rawPayloadJson: {},
        normalizedPayloadJson: normalized(clientId),
        enrichmentMetadataJson: enrichment({
          clientAccountId: clientId,
          explanation: "aligned",
          audit: auditHistory(clientId),
        }),
      },
    });
    const inconsistent = await prisma.sourceLeadEvent.create({
      data: {
        sourceProvider: "facebook",
        sourceSystem: "meta_lead_ads",
        sourceType: "lead_form",
        sourceLeadId: `inconsistent_del_${stamp}`,
        clientAccountIdResolved: null,
        status: "normalized",
        rawPayloadJson: {},
        normalizedPayloadJson: normalized(clientId),
        enrichmentMetadataJson: enrichment({
          clientAccountId: clientId,
          explanation: "inconsistent snapshot",
          audit: inconsistentAudit,
        }),
      },
    });
    eventIds.push(aligned.id, inconsistent.id);

    const impact = await getClientDeletionImpact(clientId);
    assert.equal("notFound" in impact, false);
    if ("notFound" in impact) return;
    assert.equal(impact.counts.sourceFunnelOriginReferences, 2);
    assert.equal(impact.counts.sourceFunnelSuggestedReferences, 2);
    assert.equal(impact.counts.sourceFunnelRows, 3);
    assert.equal(impact.affectedRows.length, 3);
    const dualRow = impact.affectedRows.find((row) => row.id === dual.id);
    assert.ok(dualRow);
    assert.deepEqual(dualRow.referencedFields, [
      "originClientAccountId",
      "suggestedClientAccountId",
    ]);
    assert.equal(impact.affectedRows.filter((row) => row.id === dual.id).length, 1);
    assert.deepEqual(
      impact.affectedRows.find((row) => row.id === originOnly.id)?.referencedFields,
      ["originClientAccountId"]
    );
    assert.deepEqual(
      impact.affectedRows.find((row) => row.id === suggestedOnly.id)?.referencedFields,
      ["suggestedClientAccountId"]
    );
    assert.equal(impact.counts.sourceEvents, 1);
    assert.equal(impact.counts.inconsistentAssociationEnrichmentSnapshots, 1);
    assert.equal(impact.counts.inconsistentAssociationNormalizedSnapshots, 1);
    assert.equal(impact.counts.inconsistentAssociationSnapshotRows, 1);
    assert.equal(impact.associationSnapshotRows.length, 1);
    assert.equal(impact.associationSnapshotRows[0]?.id, inconsistent.id);
    assert.deepEqual(impact.associationSnapshotRows[0]?.referencedFields, [
      ENRICHMENT_ASSOCIATION_CLIENT_FIELD,
      NORMALIZED_ASSOCIATION_CLIENT_FIELD,
    ]);
    assert.equal(
      impact.blockers.filter((blocker) => blocker.includes("SourceFunnel")).length,
      1
    );
    assert.match(impact.blockers.join(" "), /3 SourceFunnel row\(s\).*2 origin, 2 suggested/);
    assert.equal(
      impact.blockers.filter((blocker) => blocker.includes("current association snapshot")).length,
      1
    );
    assert.equal(impact.blocked, true);

    const deleted = await deleteClientAdmin(clientId, true);
    assert.equal("code" in deleted && deleted.code, "CLIENT_HAS_DEPENDENCIES");
    const dualStill = await prisma.sourceFunnel.findUniqueOrThrow({ where: { id: dual.id } });
    assert.equal(dualStill.originClientAccountId, clientId);
    assert.equal(dualStill.suggestedClientAccountId, clientId);
    const inconsistentStill = await prisma.sourceLeadEvent.findUniqueOrThrow({
      where: { id: inconsistent.id },
    });
    assert.equal(inconsistentStill.clientAccountIdResolved, null);
    assert.equal(
      asRecord(asRecord(inconsistentStill.enrichmentMetadataJson)?.association)?.clientAccountId,
      clientId
    );
    assert.equal(
      asRecord(asRecord(inconsistentStill.normalizedPayloadJson)?.association)?.client_account_id,
      clientId
    );
    assert.deepEqual(
      asRecord(inconsistentStill.enrichmentMetadataJson)?.associationAudit,
      inconsistentAudit
    );
    const alignedStill = await prisma.sourceLeadEvent.findUniqueOrThrow({ where: { id: aligned.id } });
    assert.equal(alignedStill.clientAccountIdResolved, clientId);
    assert.equal(
      asRecord(asRecord(alignedStill.enrichmentMetadataJson)?.association)?.clientAccountId,
      clientId
    );

    const portalImpact = await getClientDeletionImpact(portalId);
    assert.equal("notFound" in portalImpact, false);
    if ("notFound" in portalImpact) return;
    assert.equal(portalImpact.blocked, true);
    assert.match(portalImpact.blockers.join(" "), /Client portal is enabled/);
    const portalDelete = await deleteClientAdmin(portalId, true);
    assert.equal("code" in portalDelete && portalDelete.code, "CLIENT_HAS_DEPENDENCIES");

    const unconfirmed = await deleteClientAdmin(emptyId, false);
    assert.equal("code" in unconfirmed && unconfirmed.code, "CONFIRMATION_REQUIRED");
    const removed = await deleteClientAdmin(emptyId, true);
    assert.equal("deleted" in removed && removed.deleted, true);
    assert.equal(
      await prisma.clientAccount.count({ where: { clientAccountId: emptyId } }),
      0
    );
    assert.equal(process.env.SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED, captureFlag);
  } finally {
    if (eventIds.length > 0) {
      await prisma.sourceLeadEvent.deleteMany({ where: { id: { in: eventIds } } });
    }
    if (funnelIds.length > 0) {
      await prisma.sourceFunnel.deleteMany({ where: { id: { in: funnelIds } } });
    }
    await prisma.clientAccount.deleteMany({
      where: { clientAccountId: { in: [clientId, emptyId, portalId] } },
    });
  }
});
