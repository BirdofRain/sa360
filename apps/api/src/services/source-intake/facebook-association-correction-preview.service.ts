import { Prisma, type PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { facebookFormProviderFunnelId } from "./facebook-form-association.js";
import {
  assembleCorrectionPreview,
  assertPreviewHasNoSensitiveKeys,
  CANDIDATE_LIMIT,
  classifyCorrectionCandidate,
  emptyRelationFlags,
  evaluateCohort,
  identityFingerprintPrefix,
  isDeliveryMarker,
  isQuietDelivery,
  type AuditSummary,
  type CorrectionCandidate,
  type CorrectionPreviewFilter,
  type CorrectionPreviewResponse,
  type RelationFlags,
} from "./facebook-association-correction-preview.js";

/**
 * Read-only eligibility preview for one confirmed Facebook Page + Form.
 * One repeatable-read, read-only transaction. No reevaluation, routing,
 * Graph, GHL, Sheets, CAPI, or dispatch calls. The preview id does not
 * authorize a later correction.
 */

export type CorrectionPreviewQuery = {
  sourceFunnelId: string;
  pageId: string;
  formId: string;
  originClientAccountId: string;
  confirmedAt: Date;
  limit: number;
  offset: number;
  decision: CorrectionPreviewFilter;
  includeAllowList: boolean;
};

type CandidateRow = {
  id: string;
  status: string;
  source_provider: string;
  source_system: string;
  page_id: string | null;
  form_id: string | null;
  source_lead_id: string | null;
  source_lead_uid: string | null;
  event_uuid: string | null;
  client_resolved: boolean;
  campaign_present: boolean;
  capture_only: boolean;
  capture_settled: boolean;
  outcome_raw: string | null;
  received_at: Date | null;
  normalized_at: Date | null;
  updated_at: Date;
  routing_on_event: boolean;
  delivered_at_present: boolean;
  approved_at_present: boolean;
  delivery_result_present: boolean;
  delivery_attempted: string | null;
  delivery_historical: string | null;
  capi_dispatched: boolean;
  live_delivery: boolean;
  cleanup_marked: boolean;
  bulk_import_on_event: boolean;
  webhook_on_event: boolean;
  association_audit: unknown;
};

export async function withReadOnlyRepeatableRead<T>(
  db: PrismaClient,
  run: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return run(tx);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
  );
}

export async function loadFacebookAssociationCorrectionPreview(
  query: CorrectionPreviewQuery,
  db: PrismaClient = prisma,
  now: Date = new Date()
): Promise<CorrectionPreviewResponse> {
  const response = await withReadOnlyRepeatableRead(db, (tx) => loadInTransaction(query, tx, now));
  assertPreviewHasNoSensitiveKeys(response);
  return response;
}

async function loadInTransaction(
  query: CorrectionPreviewQuery,
  tx: Prisma.TransactionClient,
  now: Date
): Promise<CorrectionPreviewResponse> {
  const providerFunnelId = facebookFormProviderFunnelId(query.pageId, query.formId);
  const confirmedAt = query.confirmedAt.toISOString();
  const funnel = await tx.sourceFunnel.findUnique({
    where: { id: query.sourceFunnelId },
    select: {
      id: true,
      provider: true,
      providerFunnelId: true,
      associationStatus: true,
      originClientAccountId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  // The unique (provider, providerFunnelId) key makes a second confirmed row
  // unreachable today. The count stays so a future constraint change fails closed.
  const otherConfirmedOrigins = funnel?.providerFunnelId
    ? await tx.sourceFunnel.count({
        where: {
          provider: "facebook",
          providerFunnelId: funnel.providerFunnelId,
          associationStatus: "confirmed",
          id: { not: funnel.id },
          NOT: { originClientAccountId: query.originClientAccountId },
        },
      })
    : 0;
  const cohort = evaluateCohort({
    funnel,
    expectedProviderFunnelId: providerFunnelId,
    originClientAccountId: query.originClientAccountId,
    confirmedAt: query.confirmedAt,
    otherConfirmedOriginCount: otherConfirmedOrigins,
  });

  const rows = await tx.$queryRaw<CandidateRow[]>`
    WITH extracted AS (
      SELECT
        id,
        status::text AS status,
        "sourceProvider"::text AS source_provider,
        "sourceSystem"::text AS source_system,
        NULLIF(btrim("sourceLeadId"), '') AS source_lead_id,
        NULLIF(btrim("sourceLeadUid"), '') AS source_lead_uid,
        NULLIF(btrim("normalizedPayloadJson"#>>'{event,event_uuid}'), '') AS event_uuid,
        ("clientAccountIdResolved" IS NOT NULL) AS client_resolved,
        (
          NULLIF(btrim("sourceCampaignId"), '') IS NOT NULL
          OR NULLIF(btrim("normalizedPayloadJson"#>>'{source,campaign_id}'), '') IS NOT NULL
        ) AS campaign_present,
        ("enrichmentMetadataJson"->>'captureOnly' = 'true') AS capture_only,
        ("enrichmentMetadataJson"->>'captureSettled' = 'true') AS capture_settled,
        NULLIF(btrim("enrichmentMetadataJson"#>>'{association,outcome}'), '') AS outcome_raw,
        "receivedAt" AS received_at,
        "normalizedAt" AS normalized_at,
        "updatedAt" AS updated_at,
        (
          "routingDryRunDecisionId" IS NOT NULL
          OR "routedAt" IS NOT NULL
          OR "routingRuleIdResolved" IS NOT NULL
          OR "destinationLocationIdResolved" IS NOT NULL
          OR "routingResultJson" IS NOT NULL
        ) AS routing_on_event,
        ("deliveredAt" IS NOT NULL) AS delivered_at_present,
        ("approvedAt" IS NOT NULL) AS approved_at_present,
        ("deliveryResultJson" IS NOT NULL) AS delivery_result_present,
        "enrichmentMetadataJson"#>>'{delivery,thisRequestAttempted}' AS delivery_attempted,
        "enrichmentMetadataJson"#>>'{delivery,historicalOutcome}' AS delivery_historical,
        ("enrichmentMetadataJson"#>>'{metaLeadgenFetch,capiDispatched}' = 'true') AS capi_dispatched,
        ("enrichmentMetadataJson"#>>'{metaLeadgenFetch,liveDelivery}' = 'true') AS live_delivery,
        (
          "cleanupStatus" IS NOT NULL
          OR "cleanupMarkedAt" IS NOT NULL
          OR NULLIF(btrim("cleanupReason"), '') IS NOT NULL
        ) AS cleanup_marked,
        ("bulkImportId" IS NOT NULL OR "bulkImportRowId" IS NOT NULL) AS bulk_import_on_event,
        ("webhookRequestLogId" IS NOT NULL) AS webhook_on_event,
        "enrichmentMetadataJson"->'associationAudit' AS association_audit,
        CASE
          WHEN NULLIF(btrim(COALESCE(
            "enrichmentMetadataJson"#>>'{association,pageId}',
            "normalizedPayloadJson"#>>'{source,page_id}'
          )), '') ~ '^[0-9]{5,32}$'
          THEN NULLIF(btrim(COALESCE(
            "enrichmentMetadataJson"#>>'{association,pageId}',
            "normalizedPayloadJson"#>>'{source,page_id}'
          )), '')
          ELSE NULL
        END AS page_id,
        CASE
          WHEN NULLIF(btrim(COALESCE(
            "enrichmentMetadataJson"#>>'{association,formId}',
            "normalizedPayloadJson"#>>'{source,form_id}'
          )), '') ~ '^[0-9]{5,32}$'
          THEN NULLIF(btrim(COALESCE(
            "enrichmentMetadataJson"#>>'{association,formId}',
            "normalizedPayloadJson"#>>'{source,form_id}'
          )), '')
          ELSE NULL
        END AS form_id
      FROM "SourceLeadEvent"
      WHERE "sourceProvider"::text = 'facebook'
        AND "sourceSystem"::text = 'meta_lead_ads'
    )
    SELECT *
    FROM extracted
    WHERE page_id = ${query.pageId}
      AND form_id = ${query.formId}
    ORDER BY id ASC
    LIMIT ${CANDIDATE_LIMIT + 1}
  `;

  const base = {
    sourceFunnelId: query.sourceFunnelId,
    pageId: query.pageId,
    formId: query.formId,
    originClientAccountId: query.originClientAccountId,
    providerFunnelId,
    confirmedAt,
    cohort,
    decision: query.decision,
    limit: query.limit,
    offset: query.offset,
    includeAllowList: query.includeAllowList,
    issuedAt: now,
  };
  if (rows.length > CANDIDATE_LIMIT) {
    return assembleCorrectionPreview({ ...base, events: [], verificationCode: "candidate_limit_exceeded" });
  }

  const evidence = await loadRelationEvidence(tx, rows);
  const classified = rows.map((row) =>
    classifyCorrectionCandidate(toCandidate(row, evidence), {
      pageId: query.pageId,
      formId: query.formId,
      confirmedAt: query.confirmedAt,
      cohortReasons: cohort.reasons,
    })
  );
  return assembleCorrectionPreview({ ...base, events: classified, verificationCode: null });
}

type RelationEvidence = {
  byEvent: Map<string, RelationFlags>;
  duplicateLeadIds: Set<string>;
};

async function loadRelationEvidence(
  tx: Prisma.TransactionClient,
  rows: CandidateRow[]
): Promise<RelationEvidence> {
  const ids = rows.map((row) => row.id);
  const byEvent = new Map<string, RelationFlags>();
  for (const id of ids) byEvent.set(id, emptyRelationFlags());
  const leadIds = [...new Set(rows.flatMap((row) => (row.source_lead_id ? [row.source_lead_id] : [])))];
  const uids = [...new Set(rows.flatMap((row) => (row.source_lead_uid ? [row.source_lead_uid] : [])))];
  const storedUuids = [...new Set(rows.flatMap((row) => (row.event_uuid ? [row.event_uuid] : [])))];

  const mark = (flag: keyof RelationFlags, eventIds: Iterable<string>) => {
    for (const id of eventIds) {
      const flags = byEvent.get(id);
      if (flags) flags[flag] = true;
    }
  };
  const present = async (
    flag: keyof RelationFlags,
    load: () => Promise<Array<{ sourceLeadEventId: string | null }>>
  ) => {
    const found = await load();
    mark(
      flag,
      found.flatMap((row) => (row.sourceLeadEventId ? [row.sourceLeadEventId] : []))
    );
  };

  if (ids.length > 0) {
    await present("fulfillmentOutbox", () =>
      tx.fulfillmentOutbox.findMany({ where: { sourceLeadEventId: { in: ids } }, select: { sourceLeadEventId: true } })
    );
    await present("allocation", () =>
      tx.leadAllocation.findMany({ where: { sourceLeadEventId: { in: ids } }, select: { sourceLeadEventId: true } })
    );
    await present("inventory", () =>
      tx.leadInventoryItem.findMany({ where: { sourceLeadEventId: { in: ids } }, select: { sourceLeadEventId: true } })
    );
    await present("eligibilityAssessment", () =>
      tx.leadEligibilityAssessment.findMany({
        where: { sourceLeadEventId: { in: ids } },
        select: { sourceLeadEventId: true },
      })
    );
    await present("deliveryNotification", () =>
      tx.deliverySuccessNotification.findMany({
        where: { sourceLeadEventId: { in: ids } },
        select: { sourceLeadEventId: true },
      })
    );
    await present("buyerDeliveredIdentity", () =>
      tx.buyerDeliveredIdentity.findMany({
        where: { sourceLeadEventId: { in: ids } },
        select: { sourceLeadEventId: true },
      })
    );
    await present("operatorReview", () =>
      tx.pplOperatorReviewItem.findMany({
        where: { sourceLeadEventId: { in: ids } },
        select: { sourceLeadEventId: true },
      })
    );
    await present("sheetsDeliveryJob", () =>
      tx.companySheetsDeliveryJob.findMany({
        where: { sourceLeadEventId: { in: ids } },
        select: { sourceLeadEventId: true },
      })
    );
    await present("sheetsDispatchIntent", () =>
      tx.companySheetsDispatchIntent.findMany({
        where: { sourceLeadEventId: { in: ids } },
        select: { sourceLeadEventId: true },
      })
    );
    await present("sheetsAdmission", () =>
      tx.clientSheetsPersonAdmission.findMany({
        where: { sourceLeadEventId: { in: ids } },
        select: { sourceLeadEventId: true },
      })
    );
    await present("sheetsDedupe", () =>
      tx.clientSheetsDedupeDecision.findMany({
        where: { sourceLeadEventId: { in: ids } },
        select: { sourceLeadEventId: true },
      })
    );
    await present("sheetsRelease", () =>
      tx.clientSheetsPersonRelease.findMany({
        where: { sourceLeadEventId: { in: ids } },
        select: { sourceLeadEventId: true },
      })
    );
    await present("ghlOutbox", () =>
      tx.ghlAssociationDispatchOutbox.findMany({
        where: { sourceLeadEventId: { in: ids } },
        select: { sourceLeadEventId: true },
      })
    );
    await present("onboardingTest", () =>
      tx.clientOnboardingTestRun.findMany({
        where: { sourceLeadEventId: { in: ids } },
        select: { sourceLeadEventId: true },
      })
    );
    await present("onboardingAudit", () =>
      tx.clientOnboardingV2AuditEvent.findMany({
        where: { sourceLeadEventId: { in: ids } },
        select: { sourceLeadEventId: true },
      })
    );
    await present("verificationAudit", () =>
      tx.leadVerificationApprovalAuditEvent.findMany({
        where: { sourceLeadEventId: { in: ids } },
        select: { sourceLeadEventId: true },
      })
    );
    await present("proofAudit", () =>
      tx.leadProofReviewAuditEvent.findMany({
        where: { sourceLeadEventId: { in: ids } },
        select: { sourceLeadEventId: true },
      })
    );
    await present("trustSyncAudit", () =>
      tx.leadCaptureTrustSyncAuditEvent.findMany({
        where: { sourceLeadEventId: { in: ids } },
        select: { sourceLeadEventId: true },
      })
    );
    await present("checkpointAudit", () =>
      tx.lf2CheckpointAAuditEvent.findMany({
        where: { sourceLeadEventId: { in: ids } },
        select: { sourceLeadEventId: true },
      })
    );
    await present("bulkImport", () =>
      tx.bulkLeadImportRow.findMany({
        where: { sourceLeadEventId: { in: ids } },
        select: { sourceLeadEventId: true },
      })
    );
    await present("webhookLog", () =>
      tx.webhookRequestLog.findMany({
        where: { sourceLeadEventId: { in: ids } },
        select: { sourceLeadEventId: true },
      })
    );
  }

  // BuyerExternalDeliveryReceipt's event key is matchedSourceLeadEventId, not sourceLeadEventId.
  if (ids.length > 0) {
    const receipts = await tx.buyerExternalDeliveryReceipt.findMany({
      where: { matchedSourceLeadEventId: { in: ids } },
      select: { matchedSourceLeadEventId: true },
    });
    mark(
      "externalReceipt",
      receipts.flatMap((row) => (row.matchedSourceLeadEventId ? [row.matchedSourceLeadEventId] : []))
    );
  }

  if (uids.length > 0) {
    const routing = await tx.routingDryRunDecision.findMany({
      where: { sourceLeadUid: { in: uids } },
      select: { sourceLeadUid: true },
    });
    const plans = await tx.leadDeliveryPlan.findMany({
      where: { sourceLeadUid: { in: uids } },
      select: { sourceLeadUid: true },
    });
    const risks = await tx.leadDuplicateRiskAssessment.findMany({
      where: { sourceLeadUid: { in: uids } },
      select: { sourceLeadUid: true },
    });
    const lifecycle = await tx.lifecycleEvent.findMany({
      where: { leadUid: { in: uids } },
      select: { leadUid: true, eventUuid: true },
    });
    const eventsByUid = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.source_lead_uid) continue;
      const list = eventsByUid.get(row.source_lead_uid) ?? [];
      list.push(row.id);
      eventsByUid.set(row.source_lead_uid, list);
    }
    const markUid = (flag: keyof RelationFlags, uid: string | null) => {
      if (!uid) return;
      mark(flag, eventsByUid.get(uid) ?? []);
    };
    for (const row of routing) markUid("routingDecision", row.sourceLeadUid);
    for (const row of plans) markUid("deliveryPlan", row.sourceLeadUid);
    for (const row of risks) markUid("duplicateRiskAssessment", row.sourceLeadUid);
    for (const row of lifecycle) markUid("lifecycleEvent", row.leadUid);
    storedUuids.push(...lifecycle.map((row) => row.eventUuid));
  }

  const eventUuids = [...new Set(storedUuids)];
  if (eventUuids.length > 0) {
    const attempts = await tx.metaDispatchAttempt.findMany({
      where: { eventUuid: { in: eventUuids } },
      select: { eventUuid: true },
    });
    const failed = await tx.failedDispatch.findMany({
      where: { eventUuid: { in: eventUuids } },
      select: { eventUuid: true },
    });
    const attemptUuids = new Set(attempts.map((row) => row.eventUuid));
    const failedUuids = new Set(failed.map((row) => row.eventUuid));
    const lifecycleByUuid = new Map<string, string[]>();
    if (uids.length > 0) {
      const lifecycle = await tx.lifecycleEvent.findMany({
        where: { eventUuid: { in: eventUuids }, leadUid: { in: uids } },
        select: { leadUid: true, eventUuid: true },
      });
      for (const row of lifecycle) {
        const list = lifecycleByUuid.get(row.eventUuid) ?? [];
        list.push(row.leadUid);
        lifecycleByUuid.set(row.eventUuid, list);
      }
    }
    for (const row of rows) {
      const flags = byEvent.get(row.id);
      if (!flags) continue;
      const related = new Set<string>();
      if (row.event_uuid) related.add(row.event_uuid);
      for (const [eventUuid, leadUids] of lifecycleByUuid) {
        if (row.source_lead_uid && leadUids.includes(row.source_lead_uid)) related.add(eventUuid);
      }
      for (const eventUuid of related) {
        if (attemptUuids.has(eventUuid)) flags.metaDispatch = true;
        if (failedUuids.has(eventUuid)) flags.failedDispatch = true;
      }
      if (row.capi_dispatched || row.live_delivery) flags.metaDispatch = true;
      if (row.bulk_import_on_event) flags.bulkImport = true;
      if (row.webhook_on_event) flags.webhookLog = true;
    }
  } else {
    for (const row of rows) {
      const flags = byEvent.get(row.id);
      if (!flags) continue;
      if (row.capi_dispatched || row.live_delivery) flags.metaDispatch = true;
      if (row.bulk_import_on_event) flags.bulkImport = true;
      if (row.webhook_on_event) flags.webhookLog = true;
    }
  }

  const duplicateLeadIds = new Set<string>();
  if (leadIds.length > 0) {
    const counts = await tx.$queryRaw<Array<{ source_lead_id: string; n: number }>>`
      SELECT "sourceLeadId" AS source_lead_id, COUNT(*)::int AS n
      FROM "SourceLeadEvent"
      WHERE "sourceProvider"::text = 'facebook'
        AND "sourceSystem"::text = 'meta_lead_ads'
        AND "sourceLeadId" IN (${Prisma.join(leadIds)})
      GROUP BY "sourceLeadId"
    `;
    for (const row of counts) {
      if (Number(row.n) > 1) duplicateLeadIds.add(row.source_lead_id);
    }
  }

  return { byEvent, duplicateLeadIds };
}

function toCandidate(row: CandidateRow, evidence: RelationEvidence): CorrectionCandidate {
  const flags = evidence.byEvent.get(row.id) ?? emptyRelationFlags();
  flags.exportViaAllocation = flags.allocation;
  const audit = readAudit(row.association_audit);
  return {
    sourceEventId: row.id,
    sourceProvider: row.source_provider,
    sourceSystem: row.source_system,
    pageId: row.page_id,
    formId: row.form_id,
    sourceLeadIdentityPresent: Boolean(row.source_lead_id),
    sourceLeadIdentityFingerprint: identityFingerprintPrefix(row.source_lead_id),
    sourceLeadUidPresent: Boolean(row.source_lead_uid),
    duplicateCanonical: Boolean(row.source_lead_id && evidence.duplicateLeadIds.has(row.source_lead_id)),
    captureOnly: row.capture_only,
    captureSettled: row.capture_settled,
    status: row.status,
    storedAssociationOutcome: row.outcome_raw,
    clientResolved: row.client_resolved,
    campaignPresent: row.campaign_present,
    receivedAt: row.received_at ? row.received_at.toISOString() : null,
    normalizedAt: row.normalized_at ? row.normalized_at.toISOString() : null,
    updatedAt: row.updated_at.toISOString(),
    routingOnEvent: row.routing_on_event,
    deliveryOnEvent: isDeliveryMarker({
      deliveredAt: row.delivered_at_present,
      approvedAt: row.approved_at_present,
      deliveryResult: row.delivery_result_present,
      attempted: row.delivery_attempted,
      historical: row.delivery_historical,
    }),
    relationFlags: flags,
    audit,
    cleanupMarked: row.cleanup_marked,
    intakeReceipt: row.webhook_on_event || flags.webhookLog,
    deliveryQuiet: isQuietDelivery(row.delivery_attempted, row.delivery_historical),
  };
}

function readAudit(value: unknown): AuditSummary {
  const empty: AuditSummary = {
    count: 0,
    lastAction: null,
    lastTimestamp: null,
    reevaluated: false,
    unverified: false,
  };
  if (value == null) return empty;
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (!Array.isArray(parsed)) return { ...empty, unverified: true };
  let lastAction: string | null = null;
  let lastTimestamp: string | null = null;
  let reevaluated = false;
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ...empty, unverified: true };
    }
    const record = entry as Record<string, unknown>;
    const action = typeof record.action === "string" ? record.action : null;
    const at = typeof record.at === "string" ? record.at : null;
    if (action === "reevaluate_association") reevaluated = true;
    if (at && (lastTimestamp === null || at > lastTimestamp)) {
      lastTimestamp = at;
      lastAction = action;
    }
  }
  return { count: parsed.length, lastAction, lastTimestamp, reevaluated, unverified: false };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
