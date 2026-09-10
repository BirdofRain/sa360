import type { Prisma, PrismaClient, SourceFunnel, SourceLeadProvider } from "@prisma/client";

import { logger } from "../../lib/logger.js";
import {
  applySourceFunnelOriginReassignment,
  clearPreviousOriginOnFunnelInventory,
  findClientAccountsByNormalizedDisplayName,
  findSourceFunnelById,
  stampNullOriginOnFunnelInventory,
  updateSourceFunnelAssociation,
  upsertSourceFunnelObservation,
} from "../../repositories/source-funnel.repository.js";
import { prisma } from "../../lib/db.js";
import {
  normalizeComparableClientName,
  parseLeadCaptureFunnelTitle,
} from "./leadcapture-funnel-title-parser.js";
import type { NextGenSourceIdentity } from "./leadcapture-nextgen-source-identity.js";

export const SOURCE_FUNNEL_LEADCAPTURE_PROVIDER = "leadcapture_io" as const satisfies SourceLeadProvider;

const IMMUTABLE_SOURCE_ID_KINDS = new Set<NextGenSourceIdentity["stableSourceIdKind"]>([
  "funnel_id",
  "form_id",
  "sa360_form_id",
  "campaign_id",
]);

export function isTrustworthyNextGenFunnelIdentity(
  identity: Pick<NextGenSourceIdentity, "stableSourceId" | "stableSourceIdKind">
): identity is NextGenSourceIdentity & { stableSourceId: string } {
  return Boolean(
    identity.stableSourceId && IMMUTABLE_SOURCE_ID_KINDS.has(identity.stableSourceIdKind)
  );
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

export type ObserveNextGenSourceFunnelInput = {
  identity: NextGenSourceIdentity;
  seenAt?: Date;
};

export type ObserveNextGenSourceFunnelResult = {
  observed: boolean;
  sourceFunnel: SourceFunnel | null;
  skippedReason?: "missing_immutable_funnel_id" | "empty_provider_funnel_id";
};

/**
 * Upsert SourceFunnel for a trustworthy NextGen funnel/form UUID.
 * Never fabricates providerFunnelId from a route key. Confirmed origin is preserved.
 */
export async function observeNextGenSourceFunnel(
  input: ObserveNextGenSourceFunnelInput,
  db: PrismaClient | Prisma.TransactionClient = prisma
): Promise<ObserveNextGenSourceFunnelResult> {
  if (!isTrustworthyNextGenFunnelIdentity(input.identity)) {
    return { observed: false, sourceFunnel: null, skippedReason: "missing_immutable_funnel_id" };
  }
  const providerFunnelId = input.identity.stableSourceId.trim();
  if (!providerFunnelId) {
    return { observed: false, sourceFunnel: null, skippedReason: "empty_provider_funnel_id" };
  }

  const seenAt = input.seenAt ?? new Date();
  const parsed = parseLeadCaptureFunnelTitle(input.identity.sourceFunnelName);
  const suggestion = await resolveSourceFunnelClientSuggestion(parsed.clientNameHint, db);

  const upserted = await upsertSourceFunnelObservation(
    {
      provider: SOURCE_FUNNEL_LEADCAPTURE_PROVIDER,
      providerFunnelId,
      observedFunnelName: input.identity.sourceFunnelName,
      nicheKey: parsed.inventoryNicheKey ?? parsed.nicheKey ?? null,
      associationStatus: suggestion.associationStatus,
      suggestedClientAccountId: suggestion.suggestedClientAccountId,
      seenAt,
    },
    db
  );

  if (upserted.associationStatus === "confirmed") {
    return { observed: true, sourceFunnel: upserted };
  }

  const next = await updateSourceFunnelAssociation(
    upserted.id,
    {
      associationStatus: suggestion.associationStatus,
      suggestedClientAccountId: suggestion.suggestedClientAccountId,
      originClientAccountId: null,
      nicheKey: parsed.inventoryNicheKey ?? parsed.nicheKey ?? upserted.nicheKey,
      observedFunnelName: input.identity.sourceFunnelName ?? upserted.observedFunnelName,
    },
    db
  );
  return { observed: true, sourceFunnel: next };
}

export async function observeNextGenSourceFunnelSafely(
  input: ObserveNextGenSourceFunnelInput,
  db: PrismaClient | Prisma.TransactionClient = prisma
): Promise<ObserveNextGenSourceFunnelResult> {
  try {
    const result = await observeNextGenSourceFunnel(input, db);
    if (!result.observed && result.skippedReason === "missing_immutable_funnel_id") {
      logger.warn("source_intake.leadcapture_nextgen.source_funnel_identity_absent", {
        stableSourceIdKind: input.identity.stableSourceIdKind,
        routeKey: input.identity.routeKey,
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
  | "reassign_requires_different_client";

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

/**
 * Initial operator confirmation for the later Admin C.O.C. UI.
 * Suggestions never become origin. This path sets originClientAccountId only
 * for unassociated/suggested funnels, or when already confirmed to the same client.
 *
 * Bounded backfill: stamps NULL origin on inventory whose SourceLeadEvent
 * sourceProvider + sourceCampaignId match this SourceFunnel. Does not rewrite
 * already-stamped origin ownership. Reassignment of a different confirmed
 * origin requires `reassignSourceFunnelOrigin`.
 */
export async function confirmSourceFunnelOrigin(
  input: ConfirmSourceFunnelOriginInput,
  db: PrismaClient = prisma
): Promise<ConfirmSourceFunnelOriginResult> {
  const originClientAccountId = requireOriginClientAccountId(input.originClientAccountId);
  return db.$transaction(async (tx) => {
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
      provider: sourceFunnel.provider,
      providerFunnelId: sourceFunnel.providerFunnelId,
      originClientAccountId,
      db: tx,
    });
    return { sourceFunnel, backfilledInventoryCount: backfill.count };
  });
}

/**
 * Operator-controlled correction: move a confirmed origin from client A to B.
 * Scoped to inventory sourced from this SourceFunnel (sourceProvider +
 * sourceCampaignId). Third-party non-null stamps are counted, not overwritten.
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
      provider: sourceFunnel.provider,
      providerFunnelId: sourceFunnel.providerFunnelId,
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
      provider: existing.provider,
      providerFunnelId: existing.providerFunnelId,
      previousOriginClientAccountId: previousOrigin,
      db: tx,
    });
    return { sourceFunnel, clearedInventoryCount: cleared.count };
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
