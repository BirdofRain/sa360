import { Prisma, type PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { facebookFormProviderFunnelId, parseFacebookFormProviderFunnelId } from "./facebook-form-association.js";
import {
  classifySourceResolutionGroup,
  emptyOutcomeCounts,
  explainUnstampedGroup,
  type SourceResolutionClassification,
  type SourceResolutionOwner,
  type StoredAssociationOutcome,
  type StoredAssociationOutcomeCounts,
} from "./facebook-source-resolution-review.js";

/**
 * Read-only Facebook Source Resolution review.
 * Queries the API database. It does not write SourceFunnel rows, events,
 * candidates, credentials, or delivery records.
 */

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_OFFSET = 500;

export type SourceResolutionReviewQuery = {
  pageId?: string | null;
  formId?: string | null;
  sourceEventId?: string | null;
  classification?: SourceResolutionClassification | null;
  limit?: number;
  offset?: number;
  associationLimit?: number;
  associationOffset?: number;
  includeEvents?: boolean;
  eventLimit?: number;
  eventOffset?: number;
};

export type SourceResolutionAssociationItem = {
  id: string;
  pageId: string;
  formId: string;
  providerFunnelId: string;
  associationStatus: string;
  originClientAccountId: string | null;
  suggestedClientAccountId: string | null;
  ownership: "confirmed" | "suggested_not_authority" | "unassociated";
  createdAt: string;
  updatedAt: string;
};

export type SourceResolutionEventRef = {
  sourceEventId: string;
  status: string;
  receivedAt: string;
  normalizedAt: string | null;
  storedAssociationOutcome: StoredAssociationOutcome;
};

export type SourceResolutionGroup = {
  pageId: string | null;
  formId: string | null;
  campaignId: string | null;
  unresolvedEvents: number;
  classification: SourceResolutionClassification;
  confirmedOriginClientAccountId: string | null;
  confirmedSourceFunnelId: string | null;
  sourceFunnelCreatedAt: string | null;
  sourceFunnelUpdatedAt: string | null;
  earliestReceivedAt: string | null;
  latestReceivedAt: string | null;
  earliestNormalizedAt: string | null;
  latestNormalizedAt: string | null;
  outcomes: StoredAssociationOutcomeCounts;
  explanation: string;
  events: SourceResolutionEventRef[];
};

export type SourceResolutionReview = {
  ok: true;
  readOnly: true;
  writesPerformed: false;
  summary: {
    events: number;
    byStatus: Array<{ status: string; events: number }>;
    settledCaptureOnly: number;
    unresolvedClient: number;
    unstampedDespiteConfirmedOwner: number;
    cannotIdentify: number;
    invalidSourceIdentifiers: number;
    unresolvedWithPageFormAndCampaign: number;
  };
  associations: {
    items: SourceResolutionAssociationItem[];
    total: number;
    limit: number;
    offset: number;
    truncated: boolean;
  };
  groups: {
    items: SourceResolutionGroup[];
    total: number;
    limit: number;
    offset: number;
  };
};

type GroupRow = {
  page_id: string | null;
  form_id: string | null;
  campaign_id: string | null;
  unresolved: number;
  earliest_received_at: Date | null;
  latest_received_at: Date | null;
  earliest_normalized_at: Date | null;
  latest_normalized_at: Date | null;
  outcome_associated: number;
  outcome_unassociated: number;
  outcome_ambiguous: number;
  outcome_missing_form_identity: number;
  outcome_invalid_form_identity: number;
  outcome_not_evaluated: number;
  outcome_association_disabled: number;
  outcome_absent: number;
  outcome_other: number;
};

type SummaryRow = {
  events: number;
  settled_capture_only: number;
  unresolved_client: number;
  unstamped_despite_confirmed_owner: number;
  cannot_identify: number;
  invalid_source_identifiers: number;
  unresolved_with_page_form_and_campaign: number;
};

type StatusRow = { status: string; events: number };

type EventRow = {
  id: string;
  status: string;
  received_at: Date;
  normalized_at: Date | null;
  outcome_key: string;
};

function bound(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(value ?? fallback)));
}

function boundOffset(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_OFFSET, Math.max(0, Math.trunc(value ?? 0)));
}

function identifiedEvents(sourceEventId: string | null): Prisma.Sql {
  return Prisma.sql`
    WITH events AS (
      SELECT
        id,
        status::text AS status,
        "receivedAt" AS received_at,
        "normalizedAt" AS normalized_at,
        "clientAccountIdResolved" AS client_account_id,
        NULLIF(btrim(COALESCE(
          "enrichmentMetadataJson"#>>'{association,pageId}',
          "normalizedPayloadJson"#>>'{source,page_id}'
        )), '') AS page_raw,
        NULLIF(btrim(COALESCE(
          "enrichmentMetadataJson"#>>'{association,formId}',
          "normalizedPayloadJson"#>>'{source,form_id}'
        )), '') AS form_raw,
        COALESCE(
          NULLIF(btrim("sourceCampaignId"), ''),
          NULLIF(btrim("normalizedPayloadJson"#>>'{source,campaign_id}'), '')
        ) AS campaign_raw,
        NULLIF(btrim("enrichmentMetadataJson"#>>'{association,outcome}'), '') AS outcome_raw,
        (
          "enrichmentMetadataJson"->>'captureOnly' = 'true'
          AND "enrichmentMetadataJson"->>'captureSettled' = 'true'
        ) AS settled_capture_only
      FROM "SourceLeadEvent"
      WHERE "sourceProvider"::text = 'facebook'
        AND "sourceSystem"::text = 'meta_lead_ads'
        AND (${sourceEventId}::text IS NULL OR id = ${sourceEventId})
    ),
    identified AS (
      SELECT
        id,
        status,
        received_at,
        normalized_at,
        client_account_id,
        CASE WHEN page_raw ~ '^[0-9]{5,32}$' THEN page_raw ELSE NULL END AS page_id,
        CASE WHEN form_raw ~ '^[0-9]{5,32}$' THEN form_raw ELSE NULL END AS form_id,
        CASE WHEN campaign_raw ~ '^[0-9]{5,32}$' THEN campaign_raw ELSE NULL END AS campaign_id,
        (
          (page_raw IS NOT NULL AND page_raw !~ '^[0-9]{5,32}$')
          OR (form_raw IS NOT NULL AND form_raw !~ '^[0-9]{5,32}$')
          OR (campaign_raw IS NOT NULL AND campaign_raw !~ '^[0-9]{5,32}$')
        ) AS identifier_invalid,
        CASE
          WHEN outcome_raw IN (
            'associated', 'unassociated', 'ambiguous', 'missing_form_identity',
            'invalid_form_identity', 'not_evaluated', 'association_disabled'
          ) THEN outcome_raw
          WHEN outcome_raw IS NULL THEN 'absent'
          ELSE 'other'
        END AS outcome_key,
        settled_capture_only,
        ((page_raw ~ '^[0-9]{5,32}$' AND form_raw ~ '^[0-9]{5,32}$') IS TRUE) AS page_form_ok
      FROM events
    )
  `;
}

function narrow(input: { pageId: string | null; formId: string | null }): Prisma.Sql {
  return Prisma.sql`
    (${input.pageId}::text IS NULL OR page_id = ${input.pageId})
    AND (${input.formId}::text IS NULL OR form_id = ${input.formId})
  `;
}

function classificationSql(classification: SourceResolutionClassification | null): Prisma.Sql {
  if (!classification) return Prisma.sql`TRUE`;
  if (classification === "cannot_identify") return Prisma.sql`NOT page_form_ok`;
  if (classification === "unknown_ownership") {
    return Prisma.sql`
      page_form_ok
      AND NOT EXISTS (
        SELECT 1 FROM "SourceFunnel" s
        WHERE s.provider::text = 'facebook'
          AND s."associationStatus"::text = 'confirmed'
          AND NULLIF(btrim(s."originClientAccountId"), '') IS NOT NULL
          AND s."providerFunnelId" = 'fbpage:' || identified.page_id || ':fbform:' || identified.form_id
      )
    `;
  }
  if (classification === "ambiguous_owner") {
    return Prisma.sql`
      page_form_ok
      AND (
        SELECT COUNT(DISTINCT NULLIF(btrim(s."originClientAccountId"), ''))
        FROM "SourceFunnel" s
        WHERE s.provider::text = 'facebook'
          AND s."associationStatus"::text = 'confirmed'
          AND s."providerFunnelId" = 'fbpage:' || identified.page_id || ':fbform:' || identified.form_id
      ) > 1
    `;
  }
  return Prisma.sql`
    page_form_ok
    AND (
      SELECT COUNT(DISTINCT NULLIF(btrim(s."originClientAccountId"), ''))
      FROM "SourceFunnel" s
      WHERE s.provider::text = 'facebook'
        AND s."associationStatus"::text = 'confirmed'
        AND s."providerFunnelId" = 'fbpage:' || identified.page_id || ':fbform:' || identified.form_id
    ) = 1
  `;
}

function outcomesFromRow(row: GroupRow): StoredAssociationOutcomeCounts {
  return {
    associated: row.outcome_associated,
    unassociated: row.outcome_unassociated,
    ambiguous: row.outcome_ambiguous,
    missing_form_identity: row.outcome_missing_form_identity,
    invalid_form_identity: row.outcome_invalid_form_identity,
    not_evaluated: row.outcome_not_evaluated,
    association_disabled: row.outcome_association_disabled,
    absent: row.outcome_absent,
    other: row.outcome_other,
  };
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function ownershipOf(status: string, originClientAccountId: string | null): SourceResolutionAssociationItem["ownership"] {
  if (status === "confirmed" && originClientAccountId) return "confirmed";
  if (status === "suggested") return "suggested_not_authority";
  return "unassociated";
}

export async function loadFacebookSourceResolutionReview(
  input: SourceResolutionReviewQuery = {},
  db: PrismaClient = prisma
): Promise<SourceResolutionReview> {
  const pageId = input.pageId ?? null;
  const formId = input.formId ?? null;
  const sourceEventId = input.sourceEventId ?? null;
  const classification = input.classification ?? null;
  const limit = bound(input.limit, DEFAULT_LIMIT);
  const offset = boundOffset(input.offset);
  const associationLimit = bound(input.associationLimit, DEFAULT_LIMIT);
  const associationOffset = boundOffset(input.associationOffset);
  const eventLimit = bound(input.eventLimit, DEFAULT_LIMIT);
  const eventOffset = boundOffset(input.eventOffset);
  const includeEvents = input.includeEvents === true && (classification === "cannot_identify" || (Boolean(pageId) && Boolean(formId)) || Boolean(sourceEventId));

  const cte = identifiedEvents(sourceEventId);
  const filters = Prisma.sql`${narrow({ pageId, formId })} AND ${classificationSql(classification)}`;

  const [summaryRows, statusRows, countRows, groupRows, associations] = await Promise.all([
    db.$queryRaw<SummaryRow[]>`
      ${cte}
      SELECT
        COUNT(*)::int AS events,
        COUNT(*) FILTER (WHERE settled_capture_only)::int AS settled_capture_only,
        COUNT(*) FILTER (WHERE client_account_id IS NULL)::int AS unresolved_client,
        COUNT(*) FILTER (
          WHERE client_account_id IS NULL
            AND page_form_ok
            AND (
              SELECT COUNT(DISTINCT NULLIF(btrim(s."originClientAccountId"), ''))
              FROM "SourceFunnel" s
              WHERE s.provider::text = 'facebook'
                AND s."associationStatus"::text = 'confirmed'
                AND s."providerFunnelId" = 'fbpage:' || identified.page_id || ':fbform:' || identified.form_id
            ) = 1
        )::int AS unstamped_despite_confirmed_owner,
        COUNT(*) FILTER (WHERE client_account_id IS NULL AND NOT page_form_ok)::int AS cannot_identify,
        COUNT(*) FILTER (WHERE client_account_id IS NULL AND identifier_invalid)::int AS invalid_source_identifiers,
        COUNT(*) FILTER (
          WHERE client_account_id IS NULL AND page_form_ok AND campaign_id IS NOT NULL
        )::int AS unresolved_with_page_form_and_campaign
      FROM identified
      WHERE ${narrow({ pageId, formId })}
    `,
    db.$queryRaw<StatusRow[]>`
      ${cte}
      SELECT status, COUNT(*)::int AS events
      FROM identified
      WHERE ${narrow({ pageId, formId })}
      GROUP BY status
      ORDER BY status
    `,
    db.$queryRaw<Array<{ total: number }>>`
      ${cte}
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT 1
        FROM identified
        WHERE client_account_id IS NULL
          AND ${filters}
        GROUP BY page_id, form_id, campaign_id
      ) grouped
    `,
    db.$queryRaw<GroupRow[]>`
      ${cte}
      SELECT
        page_id,
        form_id,
        campaign_id,
        COUNT(*)::int AS unresolved,
        MIN(received_at) AS earliest_received_at,
        MAX(received_at) AS latest_received_at,
        MIN(normalized_at) AS earliest_normalized_at,
        MAX(normalized_at) AS latest_normalized_at,
        COUNT(*) FILTER (WHERE outcome_key = 'associated')::int AS outcome_associated,
        COUNT(*) FILTER (WHERE outcome_key = 'unassociated')::int AS outcome_unassociated,
        COUNT(*) FILTER (WHERE outcome_key = 'ambiguous')::int AS outcome_ambiguous,
        COUNT(*) FILTER (WHERE outcome_key = 'missing_form_identity')::int AS outcome_missing_form_identity,
        COUNT(*) FILTER (WHERE outcome_key = 'invalid_form_identity')::int AS outcome_invalid_form_identity,
        COUNT(*) FILTER (WHERE outcome_key = 'not_evaluated')::int AS outcome_not_evaluated,
        COUNT(*) FILTER (WHERE outcome_key = 'association_disabled')::int AS outcome_association_disabled,
        COUNT(*) FILTER (WHERE outcome_key = 'absent')::int AS outcome_absent,
        COUNT(*) FILTER (WHERE outcome_key = 'other')::int AS outcome_other
      FROM identified
      WHERE client_account_id IS NULL
        AND ${filters}
      GROUP BY page_id, form_id, campaign_id
      ORDER BY unresolved DESC, page_id NULLS FIRST, form_id NULLS FIRST, campaign_id NULLS FIRST
      LIMIT ${limit}
      OFFSET ${offset}
    `,
    loadAssociations(db, { pageId, formId, limit: associationLimit, offset: associationOffset }),
  ]);

  const providerIds = groupRows.flatMap((row) =>
    row.page_id && row.form_id ? [facebookFormProviderFunnelId(row.page_id, row.form_id)] : []
  );
  const funnels = providerIds.length
    ? await db.sourceFunnel.findMany({
        where: { provider: "facebook", providerFunnelId: { in: providerIds } },
        select: {
          id: true,
          providerFunnelId: true,
          associationStatus: true,
          originClientAccountId: true,
          createdAt: true,
          updatedAt: true,
        },
      })
    : [];
  const ownersByKey = new Map<string, SourceResolutionOwner[]>();
  for (const funnel of funnels) {
    if (funnel.associationStatus !== "confirmed" || !funnel.originClientAccountId || !funnel.providerFunnelId) continue;
    const parsed = parseFacebookFormProviderFunnelId(funnel.providerFunnelId);
    if (!parsed) continue;
    const key = `${parsed.pageId}:${parsed.formId}`;
    const list = ownersByKey.get(key) ?? [];
    list.push({
      sourceFunnelId: funnel.id,
      originClientAccountId: funnel.originClientAccountId,
      createdAt: funnel.createdAt,
      updatedAt: funnel.updatedAt,
    });
    ownersByKey.set(key, list);
  }

  const groups = groupRows.map((row) => {
    const outcomes = outcomesFromRow(row);
    const classified = classifySourceResolutionGroup({
      pageId: row.page_id,
      formId: row.form_id,
      unresolvedEvents: row.unresolved,
      owners: row.page_id && row.form_id ? ownersByKey.get(`${row.page_id}:${row.form_id}`) ?? [] : [],
    });
    return {
      pageId: row.page_id,
      formId: row.form_id,
      campaignId: row.campaign_id,
      unresolvedEvents: row.unresolved,
      ...classified,
      earliestReceivedAt: iso(row.earliest_received_at),
      latestReceivedAt: iso(row.latest_received_at),
      earliestNormalizedAt: iso(row.earliest_normalized_at),
      latestNormalizedAt: iso(row.latest_normalized_at),
      outcomes,
      explanation: explainUnstampedGroup({ classification: classified.classification, outcomes }),
      events: [] as SourceResolutionEventRef[],
    };
  });

  if (includeEvents && groups.length > 0) {
    const target = groups.length === 1 ? groups[0] : null;
    if (target) {
      const eventRows = await db.$queryRaw<EventRow[]>`
        ${cte}
        SELECT id, status, received_at, normalized_at, outcome_key
        FROM identified
        WHERE client_account_id IS NULL
          AND ${filters}
          AND page_id IS NOT DISTINCT FROM ${target.pageId}
          AND form_id IS NOT DISTINCT FROM ${target.formId}
          AND campaign_id IS NOT DISTINCT FROM ${target.campaignId}
        ORDER BY received_at DESC, id DESC
        LIMIT ${eventLimit}
        OFFSET ${eventOffset}
      `;
      target.events = eventRows.map((row) => ({
        sourceEventId: row.id,
        status: row.status,
        receivedAt: row.received_at.toISOString(),
        normalizedAt: iso(row.normalized_at),
        storedAssociationOutcome: row.outcome_key as StoredAssociationOutcome,
      }));
    }
  }

  const summary = summaryRows[0] ?? {
    events: 0,
    settled_capture_only: 0,
    unresolved_client: 0,
    unstamped_despite_confirmed_owner: 0,
    cannot_identify: 0,
    invalid_source_identifiers: 0,
    unresolved_with_page_form_and_campaign: 0,
  };

  return {
    ok: true,
    readOnly: true,
    writesPerformed: false,
    summary: {
      events: summary.events,
      byStatus: statusRows.map((row) => ({ status: row.status, events: row.events })),
      settledCaptureOnly: summary.settled_capture_only,
      unresolvedClient: summary.unresolved_client,
      unstampedDespiteConfirmedOwner: summary.unstamped_despite_confirmed_owner,
      cannotIdentify: summary.cannot_identify,
      invalidSourceIdentifiers: summary.invalid_source_identifiers,
      unresolvedWithPageFormAndCampaign: summary.unresolved_with_page_form_and_campaign,
    },
    associations,
    groups: {
      items: groups,
      total: countRows[0]?.total ?? 0,
      limit,
      offset,
    },
  };
}

async function loadAssociations(
  db: PrismaClient,
  input: { pageId: string | null; formId: string | null; limit: number; offset: number }
): Promise<SourceResolutionReview["associations"]> {
  const providerFunnelId =
    input.pageId && input.formId
      ? facebookFormProviderFunnelId(input.pageId, input.formId)
      : null;
  const where: Prisma.SourceFunnelWhereInput = {
    provider: "facebook",
    ...(providerFunnelId
      ? { providerFunnelId }
      : input.pageId
        ? { providerFunnelId: { startsWith: `fbpage:${input.pageId}:fbform:` } }
        : { providerFunnelId: { startsWith: "fbpage:" } }),
  };
  const [total, rows] = await Promise.all([
    db.sourceFunnel.count({ where }),
    db.sourceFunnel.findMany({
      where,
      orderBy: [{ providerFunnelId: "asc" }, { id: "asc" }],
      skip: input.offset,
      take: input.limit,
      select: {
        id: true,
        providerFunnelId: true,
        associationStatus: true,
        originClientAccountId: true,
        suggestedClientAccountId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);
  const items: SourceResolutionAssociationItem[] = [];
  for (const row of rows) {
    const parsed = parseFacebookFormProviderFunnelId(row.providerFunnelId);
    if (!parsed || !row.providerFunnelId) continue;
    items.push({
      id: row.id,
      pageId: parsed.pageId,
      formId: parsed.formId,
      providerFunnelId: row.providerFunnelId,
      associationStatus: row.associationStatus,
      originClientAccountId: row.originClientAccountId,
      suggestedClientAccountId: row.suggestedClientAccountId,
      ownership: ownershipOf(row.associationStatus, row.originClientAccountId),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  return {
    items,
    total,
    limit: input.limit,
    offset: input.offset,
    truncated: input.offset + items.length < total,
  };
}
