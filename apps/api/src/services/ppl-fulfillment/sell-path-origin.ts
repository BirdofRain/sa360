/**
 * Sell-path origin rule for buyer availability, selection preview, and reserve.
 *
 * A persisted stamp equal to the buyer is excluded. A missing stamp is
 * reconciled only through the confirmed LeadCapture association. That
 * confirmed association excludes the buyer it names. Any other missing or
 * unconfirmed origin stays eligible for every buyer and is not written back
 * onto the inventory row.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import {
  EMPTY_LEADCAPTURE_SOURCE_IDENTITY_SIGNALS,
  leadCaptureSourceIdentitySignalsFromLifecyclePayload,
  withLeadCaptureSourceCampaignIdFallback,
  type LeadCaptureSourceIdentitySignals,
} from "../source-intake/leadcapture-source-identity-signals.js";
import { resolveConfirmedLeadCaptureSourceAssociation } from "../source-intake/leadcapture-source-association.service.js";
import { SOURCE_FUNNEL_LEADCAPTURE_PROVIDER } from "../source-intake/source-funnel.service.js";
import { isOriginClientBuyerIneligible } from "./origin-client-exclusion.js";

type OriginDb = PrismaClient | Prisma.TransactionClient;

type ReconciledOrigin =
  | { kind: "reconciled"; originClientAccountId: string }
  | { kind: "unresolved"; reason: string };

export type SellPathOriginCache = Map<string, ReconciledOrigin>;

export type SellPathOriginDecision = {
  /** False only when confirmed origin matches the buyer. */
  eligible: boolean;
  buyerOrigin: boolean;
  reconciledFromSourceFunnel: boolean;
  /**
   * Present when the stamp is missing and no confirmed association matched.
   * This is evidence, not an exclusion.
   */
  unresolvedReason: string | null;
};

function originSignalCacheKey(
  sourceCampaignId: string | null,
  signals: LeadCaptureSourceIdentitySignals
): string {
  return JSON.stringify([
    sourceCampaignId,
    signals.providerFormIds,
    signals.parentUrlKey,
    signals.hostedPageSlug,
  ]);
}

async function reconcileMissingOrigin(
  input: {
    sourceProvider: string | null | undefined;
    sourceCampaignId: string | null | undefined;
    normalizedPayloadJson: unknown;
  },
  db: OriginDb,
  cache: SellPathOriginCache
): Promise<ReconciledOrigin> {
  if (input.sourceProvider !== SOURCE_FUNNEL_LEADCAPTURE_PROVIDER) {
    return { kind: "unresolved", reason: "provider_not_reconcilable" };
  }
  const parsed = lifecycleEventSchema.safeParse(input.normalizedPayloadJson);
  const signals = withLeadCaptureSourceCampaignIdFallback(
    parsed.success
      ? leadCaptureSourceIdentitySignalsFromLifecyclePayload(parsed.data)
      : EMPTY_LEADCAPTURE_SOURCE_IDENTITY_SIGNALS,
    input.sourceCampaignId ?? null
  );
  const cacheKey = originSignalCacheKey(input.sourceCampaignId ?? null, signals);
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const association = await resolveConfirmedLeadCaptureSourceAssociation(signals, db);
  const resolved: ReconciledOrigin = association.matched
    ? { kind: "reconciled", originClientAccountId: association.match.originClientAccountId }
    : { kind: "unresolved", reason: association.reason };
  cache.set(cacheKey, resolved);
  return resolved;
}

export function createSellPathOriginCache(): SellPathOriginCache {
  return new Map();
}

/**
 * Read-only. Never stamps `originClientAccountId` and never confirms a funnel.
 */
export async function evaluateSellPathOrigin(
  input: {
    originClientAccountId: string | null | undefined;
    sourceProvider: string | null | undefined;
    sourceCampaignId: string | null | undefined;
    normalizedPayloadJson: unknown;
    buyerClientAccountId: string;
    db: OriginDb;
    cache?: SellPathOriginCache;
  }
): Promise<SellPathOriginDecision> {
  const stamped = input.originClientAccountId?.trim() || null;
  if (stamped) {
    const buyerOrigin = isOriginClientBuyerIneligible(stamped, input.buyerClientAccountId);
    return {
      eligible: !buyerOrigin,
      buyerOrigin,
      reconciledFromSourceFunnel: false,
      unresolvedReason: null,
    };
  }

  const cache = input.cache ?? createSellPathOriginCache();
  const reconciled = await reconcileMissingOrigin(
    {
      sourceProvider: input.sourceProvider,
      sourceCampaignId: input.sourceCampaignId,
      normalizedPayloadJson: input.normalizedPayloadJson,
    },
    input.db,
    cache
  );
  if (reconciled.kind === "unresolved") {
    return {
      eligible: true,
      buyerOrigin: false,
      reconciledFromSourceFunnel: false,
      unresolvedReason: reconciled.reason,
    };
  }
  const buyerOrigin = isOriginClientBuyerIneligible(
    reconciled.originClientAccountId,
    input.buyerClientAccountId
  );
  return {
    eligible: !buyerOrigin,
    buyerOrigin,
    reconciledFromSourceFunnel: true,
    unresolvedReason: null,
  };
}
