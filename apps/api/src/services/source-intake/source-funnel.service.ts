import type { Prisma, PrismaClient, SourceFunnel, SourceLeadProvider } from "@prisma/client";

import { logger } from "../../lib/logger.js";
import {
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

export type ConfirmSourceFunnelOriginInput = {
  sourceFunnelId: string;
  originClientAccountId: string;
};

export type ConfirmSourceFunnelOriginResult = {
  sourceFunnel: SourceFunnel;
  backfilledInventoryCount: number;
};

/**
 * Operator confirmation contract for the next Admin C.O.C. PR.
 * Suggestions never become origin. Only this path sets originClientAccountId.
 *
 * Bounded backfill: stamps NULL origin on inventory whose SourceLeadEvent
 * sourceCampaignId equals this funnel's providerFunnelId. Does not rewrite
 * already-stamped origin ownership.
 */
export async function confirmSourceFunnelOrigin(
  input: ConfirmSourceFunnelOriginInput,
  db: PrismaClient = prisma
): Promise<ConfirmSourceFunnelOriginResult> {
  const originClientAccountId = input.originClientAccountId.trim();
  if (!originClientAccountId) {
    throw new Error("origin_client_account_id_required");
  }
  return db.$transaction(async (tx) => {
    const existing = await findSourceFunnelById(input.sourceFunnelId, tx);
    if (!existing) throw new Error("source_funnel_not_found");
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

export async function clearSourceFunnelAssociation(
  sourceFunnelId: string,
  db: PrismaClient = prisma
): Promise<SourceFunnel> {
  const existing = await findSourceFunnelById(sourceFunnelId, db);
  if (!existing) throw new Error("source_funnel_not_found");
  return updateSourceFunnelAssociation(
    existing.id,
    {
      associationStatus: "unassociated",
      suggestedClientAccountId: null,
      originClientAccountId: null,
    },
    db
  );
}

export function confirmedOriginClientAccountId(
  funnel: Pick<SourceFunnel, "associationStatus" | "originClientAccountId"> | null | undefined
): string | null {
  if (!funnel) return null;
  if (funnel.associationStatus !== "confirmed") return null;
  const origin = funnel.originClientAccountId?.trim();
  return origin || null;
}
