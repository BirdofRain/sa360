import type { Prisma, PrismaClient, SourceFunnel, SourceLeadProvider } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import { logger } from "../../lib/logger.js";
import {
  applySourceFunnelOriginReassignment,
  clearPreviousOriginOnFunnelInventory,
  createSourceFunnel,
  findClientAccountsByNormalizedDisplayName,
  findSourceFunnelById,
  findSourceFunnelByParentUrlKey,
  findSourceFunnelByProviderId,
  sourceCampaignIdsForFunnel,
  stampNullOriginOnFunnelInventory,
  updateSourceFunnelAssociation,
  upsertSourceFunnelObservation,
} from "../../repositories/source-funnel.repository.js";
import { prisma } from "../../lib/db.js";
import {
  normalizeComparableClientName,
  parseLeadCaptureFunnelTitle,
} from "./leadcapture-funnel-title-parser.js";
import { normalizeLeadCapturePageUrlOrSlug } from "./leadcapture-parent-url.js";
import type { NextGenSourceIdentity } from "./leadcapture-nextgen-source-identity.js";

export const SOURCE_FUNNEL_LEADCAPTURE_PROVIDER = "leadcapture_io" as const satisfies SourceLeadProvider;

const PROVIDER_UUID_SOURCE_ID_KINDS = new Set<NextGenSourceIdentity["stableSourceIdKind"]>([
  "funnel_id",
  "form_id",
  "sa360_form_id",
  "campaign_id",
]);

const TRUSTWORTHY_SOURCE_ID_KINDS = new Set<NextGenSourceIdentity["stableSourceIdKind"]>([
  ...PROVIDER_UUID_SOURCE_ID_KINDS,
  "parent_url_key",
]);

export function isTrustworthyNextGenFunnelIdentity(
  identity: Pick<NextGenSourceIdentity, "stableSourceId" | "stableSourceIdKind">
): identity is NextGenSourceIdentity & { stableSourceId: string } {
  return Boolean(
    identity.stableSourceId && TRUSTWORTHY_SOURCE_ID_KINDS.has(identity.stableSourceIdKind)
  );
}

export function providerFunnelIdFromIdentity(
  identity: Pick<NextGenSourceIdentity, "stableSourceId" | "stableSourceIdKind">
): string | null {
  if (
    identity.stableSourceId &&
    PROVIDER_UUID_SOURCE_ID_KINDS.has(identity.stableSourceIdKind)
  ) {
    const trimmed = identity.stableSourceId.trim();
    return trimmed || null;
  }
  return null;
}

export type SourceFunnelSuggestion = {
  associationStatus: "unassociated" | "suggested";
  suggestedClientAccountId: string | null;
  matchCount: number;
};

export function classifyClientNameSuggestion(
  matches: Array<{ clientAccountId: string }>
): SourceFunnelSuggestion {
  if (matches.length === 1) {
    return {
      associationStatus: "suggested",
      suggestedClientAccountId: matches[0]!.clientAccountId,
      matchCount: 1,
    };
  }
  return {
    associationStatus: "unassociated",
    suggestedClientAccountId: null,
    matchCount: matches.length,
  };
}

export async function resolveSourceFunnelClientSuggestion(
  clientNameHint: string | undefined,
  db: PrismaClient | Prisma.TransactionClient = prisma
): Promise<SourceFunnelSuggestion> {
  const hint = clientNameHint?.trim();
  if (!hint) {
    return { associationStatus: "unassociated", suggestedClientAccountId: null, matchCount: 0 };
  }
  const matches = await findClientAccountsByNormalizedDisplayName(hint, db);
  const comparable = normalizeComparableClientName(hint);
  const exact = matches.filter(
    (row) => normalizeComparableClientName(row.clientDisplayName) === comparable
  );
  return classifyClientNameSuggestion(exact);
}

export type SourceFunnelIdentityConflict = {
  providerFunnelId: string;
  parentUrlKey: string;
  providerFunnelRowId: string;
  parentUrlKeyRowId: string;
};

export type ObserveNextGenSourceFunnelInput = {
  identity: NextGenSourceIdentity;
  seenAt?: Date;
};

export type ObserveNextGenSourceFunnelResult = {
  observed: boolean;
  sourceFunnel: SourceFunnel | null;
  skippedReason?: "missing_source_identity" | "empty_provider_identity" | "identity_conflict";
  identityConflict?: SourceFunnelIdentityConflict;
};

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof PrismaNamespace.PrismaClientKnownRequestError && err.code === "P2002";
}

async function applySuggestionUnlessConfirmed(
  funnel: SourceFunnel,
  suggestion: SourceFunnelSuggestion,
  observedFunnelName: string | null,
  nicheKey: string | null,
  db: PrismaClient | Prisma.TransactionClient
): Promise<SourceFunnel> {
  if (funnel.associationStatus === "confirmed") {
    return funnel;
  }
  return updateSourceFunnelAssociation(
    funnel.id,
    {
      associationStatus: suggestion.associationStatus,
      suggestedClientAccountId: suggestion.suggestedClientAccountId,
      originClientAccountId: null,
      nicheKey: nicheKey ?? funnel.nicheKey,
      observedFunnelName: observedFunnelName ?? funnel.observedFunnelName,
    },
    db
  );
}

/**
 * Upsert SourceFunnel for a trustworthy NextGen identity (UUID and/or parent_url_key).
 * Never fabricates providerFunnelId from a route key. Confirmed origin is preserved.
 * UUID and parentUrlKey that already map to different rows are not silently merged.
 */
export async function observeNextGenSourceFunnel(
  input: ObserveNextGenSourceFunnelInput,
  db: PrismaClient | Prisma.TransactionClient = prisma
): Promise<ObserveNextGenSourceFunnelResult> {
  const providerFunnelId = providerFunnelIdFromIdentity(input.identity);
  const parentUrlKey = input.identity.parentUrlKey?.trim() || null;
  const pageSlug = input.identity.pageSlug?.trim() || null;

  if (!providerFunnelId && !parentUrlKey) {
    return { observed: false, sourceFunnel: null, skippedReason: "missing_source_identity" };
  }

  const seenAt = input.seenAt ?? new Date();
  const parsed = parseLeadCaptureFunnelTitle(input.identity.sourceFunnelName);
  const suggestion = await resolveSourceFunnelClientSuggestion(parsed.clientNameHint, db);
  const observedFunnelName = input.identity.sourceFunnelName?.trim() || null;
  const nicheKey = parsed.inventoryNicheKey ?? parsed.nicheKey ?? null;

  const byUuid = providerFunnelId
    ? await findSourceFunnelByProviderId(
        { provider: SOURCE_FUNNEL_LEADCAPTURE_PROVIDER, providerFunnelId },
        db
      )
    : null;
  const byUrl = parentUrlKey
    ? await findSourceFunnelByParentUrlKey(
        { provider: SOURCE_FUNNEL_LEADCAPTURE_PROVIDER, parentUrlKey },
        db
      )
    : null;

  if (byUuid && byUrl && byUuid.id !== byUrl.id && providerFunnelId && parentUrlKey) {
    const identityConflict: SourceFunnelIdentityConflict = {
      providerFunnelId,
      parentUrlKey,
      providerFunnelRowId: byUuid.id,
      parentUrlKeyRowId: byUrl.id,
    };
    const preferred = await upsertSourceFunnelObservation(
      {
        provider: SOURCE_FUNNEL_LEADCAPTURE_PROVIDER,
        providerFunnelId,
        parentUrlKey: null,
        pageSlug: null,
        observedFunnelName,
        nicheKey,
        associationStatus: suggestion.associationStatus,
        suggestedClientAccountId: suggestion.suggestedClientAccountId,
        seenAt,
        existing: byUuid,
      },
      db
    );
    const next = await applySuggestionUnlessConfirmed(
      preferred,
      suggestion,
      observedFunnelName,
      nicheKey,
      db
    );
    return {
      observed: true,
      sourceFunnel: next,
      skippedReason: "identity_conflict",
      identityConflict,
    };
  }

  const existing = byUuid ?? byUrl ?? null;

  try {
    const upserted = await upsertSourceFunnelObservation(
      {
        provider: SOURCE_FUNNEL_LEADCAPTURE_PROVIDER,
        providerFunnelId,
        parentUrlKey,
        pageSlug,
        observedFunnelName,
        nicheKey,
        associationStatus: suggestion.associationStatus,
        suggestedClientAccountId: suggestion.suggestedClientAccountId,
        seenAt,
        existing,
      },
      db
    );
    const next = await applySuggestionUnlessConfirmed(
      upserted,
      suggestion,
      observedFunnelName,
      nicheKey,
      db
    );
    return { observed: true, sourceFunnel: next };
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    logger.warn("source_intake.leadcapture_nextgen.source_funnel_identity_race", {
      providerFunnelId,
      parentUrlKey,
      error: err instanceof Error ? err.message : "unique_constraint",
    });
    const racedUuid = providerFunnelId
      ? await findSourceFunnelByProviderId(
          { provider: SOURCE_FUNNEL_LEADCAPTURE_PROVIDER, providerFunnelId },
          db
        )
      : null;
    const racedUrl = parentUrlKey
      ? await findSourceFunnelByParentUrlKey(
          { provider: SOURCE_FUNNEL_LEADCAPTURE_PROVIDER, parentUrlKey },
          db
        )
      : null;
    const fallback = racedUuid ?? racedUrl;
    if (!fallback) {
      return { observed: false, sourceFunnel: null, skippedReason: "empty_provider_identity" };
    }
    if (racedUuid && racedUrl && racedUuid.id !== racedUrl.id) {
      return {
        observed: true,
        sourceFunnel: racedUuid,
        skippedReason: "identity_conflict",
        identityConflict: {
          providerFunnelId: providerFunnelId ?? racedUuid.providerFunnelId ?? "",
          parentUrlKey: parentUrlKey ?? racedUrl.parentUrlKey ?? "",
          providerFunnelRowId: racedUuid.id,
          parentUrlKeyRowId: racedUrl.id,
        },
      };
    }
    return { observed: true, sourceFunnel: fallback };
  }
}

export async function observeNextGenSourceFunnelSafely(
  input: ObserveNextGenSourceFunnelInput,
  db: PrismaClient | Prisma.TransactionClient = prisma
): Promise<ObserveNextGenSourceFunnelResult> {
  try {
    const result = await observeNextGenSourceFunnel(input, db);
    if (!result.observed && result.skippedReason === "missing_source_identity") {
      logger.warn("source_intake.leadcapture_nextgen.source_funnel_identity_absent", {
        stableSourceIdKind: input.identity.stableSourceIdKind,
        routeKey: input.identity.routeKey,
      });
    }
    if (result.identityConflict) {
      logger.warn("source_intake.leadcapture_nextgen.source_funnel_identity_conflict", {
        providerFunnelId: result.identityConflict.providerFunnelId,
        parentUrlKey: result.identityConflict.parentUrlKey,
        providerFunnelRowId: result.identityConflict.providerFunnelRowId,
        parentUrlKeyRowId: result.identityConflict.parentUrlKeyRowId,
        operatorAction: "reconcile_source_funnel_identities_manually",
      });
    }
    return result;
  } catch (err) {
    logger.warn("source_intake.leadcapture_nextgen.source_funnel_observe_failed", {
      stableSourceIdKind: input.identity.stableSourceIdKind,
      error: err instanceof Error ? err.message : "observe_failed",
    });
    return { observed: false, sourceFunnel: null };
  }
}

export type SourceFunnelOriginCorrectionErrorCode =
  | "origin_client_account_id_required"
  | "source_funnel_not_found"
  | "origin_client_account_not_found"
  | "confirm_requires_explicit_reassign"
  | "reassign_requires_confirmed_origin"
  | "reassign_requires_different_client"
  | "invalid_page_url_or_slug";

export class SourceFunnelOriginCorrectionError extends Error {
  readonly code: SourceFunnelOriginCorrectionErrorCode;
  readonly currentOriginClientAccountId?: string | null;
  readonly requestedOriginClientAccountId?: string;

  constructor(
    code: SourceFunnelOriginCorrectionErrorCode,
    message: string,
    extras?: {
      currentOriginClientAccountId?: string | null;
      requestedOriginClientAccountId?: string;
    }
  ) {
    super(message);
    this.name = "SourceFunnelOriginCorrectionError";
    this.code = code;
    this.currentOriginClientAccountId = extras?.currentOriginClientAccountId;
    this.requestedOriginClientAccountId = extras?.requestedOriginClientAccountId;
  }
}

export function isSourceFunnelOriginCorrectionError(
  err: unknown
): err is SourceFunnelOriginCorrectionError {
  return err instanceof SourceFunnelOriginCorrectionError;
}

export type ConfirmSourceFunnelOriginInput = {
  sourceFunnelId: string;
  originClientAccountId: string;
};

export type ConfirmSourceFunnelOriginResult = {
  sourceFunnel: SourceFunnel;
  backfilledInventoryCount: number;
};

export type ReassignSourceFunnelOriginInput = {
  sourceFunnelId: string;
  originClientAccountId: string;
};

export type ReassignSourceFunnelOriginResult = {
  sourceFunnel: SourceFunnel;
  newlyStamped: number;
  reassigned: number;
  conflictsSkipped: number;
};

export type ClearSourceFunnelAssociationResult = {
  sourceFunnel: SourceFunnel;
  clearedInventoryCount: number;
};

function requireOriginClientAccountId(raw: string): string {
  const originClientAccountId = raw.trim();
  if (!originClientAccountId) {
    throw new SourceFunnelOriginCorrectionError(
      "origin_client_account_id_required",
      "origin_client_account_id_required"
    );
  }
  return originClientAccountId;
}

function confirmedOriginOnFunnel(
  funnel: Pick<SourceFunnel, "associationStatus" | "originClientAccountId">
): string | null {
  return confirmedOriginClientAccountId(funnel);
}

function inventoryIdentities(funnel: SourceFunnel) {
  return {
    provider: funnel.provider,
    providerFunnelId: funnel.providerFunnelId,
    parentUrlKey: funnel.parentUrlKey,
    sourceCampaignIds: sourceCampaignIdsForFunnel(funnel),
  };
}

async function confirmSourceFunnelOriginTx(
  input: ConfirmSourceFunnelOriginInput,
  tx: Prisma.TransactionClient
): Promise<ConfirmSourceFunnelOriginResult> {
  const originClientAccountId = requireOriginClientAccountId(input.originClientAccountId);
  const existing = await findSourceFunnelById(input.sourceFunnelId, tx);
  if (!existing) {
    throw new SourceFunnelOriginCorrectionError(
      "source_funnel_not_found",
      "source_funnel_not_found"
    );
  }
  const currentOrigin = confirmedOriginOnFunnel(existing);
  if (currentOrigin && currentOrigin !== originClientAccountId) {
    throw new SourceFunnelOriginCorrectionError(
      "confirm_requires_explicit_reassign",
      `SourceFunnel ${existing.id} is already confirmed to ${currentOrigin}; use reassignSourceFunnelOrigin to change origin to ${originClientAccountId}.`,
      {
        currentOriginClientAccountId: currentOrigin,
        requestedOriginClientAccountId: originClientAccountId,
      }
    );
  }
  const sourceFunnel = await updateSourceFunnelAssociation(
    existing.id,
    {
      associationStatus: "confirmed",
      suggestedClientAccountId: existing.suggestedClientAccountId,
      originClientAccountId,
    },
    tx
  );
  const backfill = await stampNullOriginOnFunnelInventory({
    ...inventoryIdentities(sourceFunnel),
    originClientAccountId,
    db: tx,
  });
  return { sourceFunnel, backfilledInventoryCount: backfill.count };
}

/**
 * Initial operator confirmation for the later Admin C.O.C. UI.
 * Suggestions never become origin. This path sets originClientAccountId only
 * for unassociated/suggested funnels, or when already confirmed to the same client.
 *
 * Bounded backfill: stamps NULL origin on inventory whose SourceLeadEvent
 * sourceProvider + sourceCampaignId match this SourceFunnel's identities
 * (providerFunnelId and/or parentUrlKey). Does not rewrite already-stamped origin
 * ownership. Reassignment of a different confirmed origin requires
 * `reassignSourceFunnelOrigin`.
 */
export async function confirmSourceFunnelOrigin(
  input: ConfirmSourceFunnelOriginInput,
  db: PrismaClient = prisma
): Promise<ConfirmSourceFunnelOriginResult> {
  return db.$transaction(async (tx) => confirmSourceFunnelOriginTx(input, tx));
}

/**
 * Operator-controlled correction: move a confirmed origin from client A to B.
 * Scoped to inventory sourced from this SourceFunnel (sourceProvider +
 * sourceCampaignId matching any identity on the row). Third-party non-null
 * stamps are counted, not overwritten.
 */
export async function reassignSourceFunnelOrigin(
  input: ReassignSourceFunnelOriginInput,
  db: PrismaClient = prisma
): Promise<ReassignSourceFunnelOriginResult> {
  const nextOriginClientAccountId = requireOriginClientAccountId(input.originClientAccountId);
  return db.$transaction(async (tx) => {
    const existing = await findSourceFunnelById(input.sourceFunnelId, tx);
    if (!existing) {
      throw new SourceFunnelOriginCorrectionError(
        "source_funnel_not_found",
        "source_funnel_not_found"
      );
    }
    const previousOrigin = confirmedOriginOnFunnel(existing);
    if (!previousOrigin) {
      throw new SourceFunnelOriginCorrectionError(
        "reassign_requires_confirmed_origin",
        `SourceFunnel ${existing.id} must already be confirmed with an origin client before reassignment.`,
        { requestedOriginClientAccountId: nextOriginClientAccountId }
      );
    }
    if (previousOrigin === nextOriginClientAccountId) {
      throw new SourceFunnelOriginCorrectionError(
        "reassign_requires_different_client",
        `SourceFunnel ${existing.id} is already confirmed to ${previousOrigin}.`,
        {
          currentOriginClientAccountId: previousOrigin,
          requestedOriginClientAccountId: nextOriginClientAccountId,
        }
      );
    }
    const nextClient = await tx.clientAccount.findUnique({
      where: { clientAccountId: nextOriginClientAccountId },
      select: { clientAccountId: true },
    });
    if (!nextClient) {
      throw new SourceFunnelOriginCorrectionError(
        "origin_client_account_not_found",
        `ClientAccount ${nextOriginClientAccountId} was not found.`,
        {
          currentOriginClientAccountId: previousOrigin,
          requestedOriginClientAccountId: nextOriginClientAccountId,
        }
      );
    }
    const sourceFunnel = await updateSourceFunnelAssociation(
      existing.id,
      {
        associationStatus: "confirmed",
        suggestedClientAccountId: existing.suggestedClientAccountId,
        originClientAccountId: nextOriginClientAccountId,
      },
      tx
    );
    const counts = await applySourceFunnelOriginReassignment({
      ...inventoryIdentities(sourceFunnel),
      previousOriginClientAccountId: previousOrigin,
      nextOriginClientAccountId,
      db: tx,
    });
    return { sourceFunnel, ...counts };
  });
}

/**
 * Correction-safe clear: registry returns to unassociated, and inventory
 * sourced from this SourceFunnel whose origin equals the previously confirmed
 * client is cleared to NULL. Third-party stamps are left untouched so
 * registry and matching inventory cannot silently disagree.
 */
export async function clearSourceFunnelAssociation(
  sourceFunnelId: string,
  db: PrismaClient = prisma
): Promise<ClearSourceFunnelAssociationResult> {
  return db.$transaction(async (tx) => {
    const existing = await findSourceFunnelById(sourceFunnelId, tx);
    if (!existing) {
      throw new SourceFunnelOriginCorrectionError(
        "source_funnel_not_found",
        "source_funnel_not_found"
      );
    }
    const previousOrigin = confirmedOriginOnFunnel(existing);
    const sourceFunnel = await updateSourceFunnelAssociation(
      existing.id,
      {
        associationStatus: "unassociated",
        suggestedClientAccountId: null,
        originClientAccountId: null,
      },
      tx
    );
    if (!previousOrigin) {
      return { sourceFunnel, clearedInventoryCount: 0 };
    }
    const cleared = await clearPreviousOriginOnFunnelInventory({
      ...inventoryIdentities(existing),
      previousOriginClientAccountId: previousOrigin,
      db: tx,
    });
    return { sourceFunnel, clearedInventoryCount: cleared.count };
  });
}

export type AssociateSourceFunnelByPageUrlInput = {
  originClientAccountId: string;
  pageUrlOrSlug: string;
};

export type AssociateSourceFunnelByPageUrlResult = {
  sourceFunnel: SourceFunnel;
  created: boolean;
  parentUrlKey: string;
  pageSlug: string | null;
  backfilledInventoryCount: number;
};

/**
 * Internal operator contract for the next Admin C.O.C. PR.
 * Operator may paste a full parent_url or a standard hosted page slug.
 * Pre-registration does not fabricate firstSeenAt. Confirm/reassign/clear
 * semantics are reused — this never silently reassigns a different origin.
 */
export async function associateSourceFunnelByPageUrl(
  input: AssociateSourceFunnelByPageUrlInput,
  db: PrismaClient = prisma
): Promise<AssociateSourceFunnelByPageUrlResult> {
  const originClientAccountId = requireOriginClientAccountId(input.originClientAccountId);
  const normalized = normalizeLeadCapturePageUrlOrSlug(input.pageUrlOrSlug);
  if (!normalized) {
    throw new SourceFunnelOriginCorrectionError(
      "invalid_page_url_or_slug",
      "invalid_page_url_or_slug"
    );
  }
  return db.$transaction(async (tx) => {
    let existing = await findSourceFunnelByParentUrlKey(
      {
        provider: SOURCE_FUNNEL_LEADCAPTURE_PROVIDER,
        parentUrlKey: normalized.parentUrlKey,
      },
      tx
    );
    let created = false;
    if (!existing) {
      existing = await createSourceFunnel(
        {
          provider: SOURCE_FUNNEL_LEADCAPTURE_PROVIDER,
          parentUrlKey: normalized.parentUrlKey,
          pageSlug: normalized.pageSlug,
          firstSeenAt: null,
          lastSeenAt: null,
          associationStatus: "unassociated",
        },
        tx
      );
      created = true;
    } else if (!existing.pageSlug && normalized.pageSlug) {
      existing = await tx.sourceFunnel.update({
        where: { id: existing.id },
        data: { pageSlug: normalized.pageSlug },
      });
    }
    const confirmed = await confirmSourceFunnelOriginTx(
      { sourceFunnelId: existing.id, originClientAccountId },
      tx
    );
    return {
      sourceFunnel: confirmed.sourceFunnel,
      created,
      parentUrlKey: normalized.parentUrlKey,
      pageSlug: confirmed.sourceFunnel.pageSlug ?? normalized.pageSlug,
      backfilledInventoryCount: confirmed.backfilledInventoryCount,
    };
  });
}

export function confirmedOriginClientAccountId(
  funnel: Pick<SourceFunnel, "associationStatus" | "originClientAccountId"> | null | undefined
): string | null {
  if (!funnel) return null;
  if (funnel.associationStatus !== "confirmed") return null;
  const origin = funnel.originClientAccountId?.trim();
  return origin || null;
}
