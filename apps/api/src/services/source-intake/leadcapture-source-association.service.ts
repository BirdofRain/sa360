/**
 * Confirmed LeadCapture client source association lookup.
 *
 * Given the identity signals of an incoming LeadCapture event, resolve the one
 * `SourceFunnel` row an operator explicitly confirmed for a client. This is the
 * single reader used by routing, inventory origin stamping, and operator
 * reconciliation so all three agree on the same evidence.
 *
 * Fail-closed rules:
 * - only `associationStatus = confirmed` with a non-null origin client matches;
 * - identity must be exact (provider funnel/form id, or canonical
 *   hostname + pathname). Hostname is never dropped;
 * - hosted-slug matching is restricted to the `my.leadcapture.io` namespace and
 *   must resolve to exactly one confirmed row;
 * - the first registered identity wins. When a stronger identity is registered
 *   but not confirmed, the lookup stops rather than falling through to a weaker
 *   signal that could belong to a different client;
 * - client display names and UTM text are never used to infer a destination.
 */

import type { Prisma, PrismaClient, SourceFunnel } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import {
  findSourceFunnelByParentUrlKey,
  findSourceFunnelByProviderId,
  listConfirmedSourceFunnelsByPageSlug,
} from "../../repositories/source-funnel.repository.js";
import { LEADCAPTURE_HOSTED_PAGE_HOST, normalizeLeadCaptureParentUrl } from "./leadcapture-parent-url.js";
import {
  hasLeadCaptureSourceIdentitySignals,
  type LeadCaptureSourceIdentitySignals,
} from "./leadcapture-source-identity-signals.js";
import { confirmedOriginClientAccountId, SOURCE_FUNNEL_LEADCAPTURE_PROVIDER } from "./source-funnel.service.js";

export type LeadCaptureSourceAssociationMatchKind =
  | "provider_form_id"
  | "parent_url_key"
  | "hosted_page_slug";

export type LeadCaptureSourceAssociationUnmatchedReason =
  | "no_source_identity"
  | "no_registered_source"
  | "source_not_confirmed"
  | "ambiguous_hosted_page_slug";

export type LeadCaptureSourceAssociationMatch = {
  sourceFunnelId: string;
  originClientAccountId: string;
  matchedBy: LeadCaptureSourceAssociationMatchKind;
  /** Operator-readable evidence for the match (page identity, form id, or slug). */
  matchEvidence: string;
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  pageSlug: string | null;
  routeKey: string | null;
};

export type LeadCaptureSourceAssociationResult =
  | { matched: true; match: LeadCaptureSourceAssociationMatch }
  | {
      matched: false;
      reason: LeadCaptureSourceAssociationUnmatchedReason;
      /** Registered-but-unusable rows, for operator review. Never a destination. */
      candidateSourceFunnelIds: string[];
    };

function unmatched(
  reason: LeadCaptureSourceAssociationUnmatchedReason,
  candidateSourceFunnelIds: string[] = []
): LeadCaptureSourceAssociationResult {
  return { matched: false, reason, candidateSourceFunnelIds };
}

function toMatch(
  funnel: SourceFunnel,
  originClientAccountId: string,
  matchedBy: LeadCaptureSourceAssociationMatchKind,
  matchEvidence: string,
  routeKey: string | null
): LeadCaptureSourceAssociationResult {
  return {
    matched: true,
    match: {
      sourceFunnelId: funnel.id,
      originClientAccountId,
      matchedBy,
      matchEvidence,
      providerFunnelId: funnel.providerFunnelId,
      parentUrlKey: funnel.parentUrlKey,
      pageSlug: funnel.pageSlug,
      routeKey,
    },
  };
}

/** A confirmed funnel whose stored page identity lives in the hosted namespace. */
function isHostedNamespaceFunnel(funnel: SourceFunnel): boolean {
  const key = funnel.parentUrlKey?.trim();
  if (!key) return false;
  const normalized = normalizeLeadCaptureParentUrl(`https://${key}`);
  return normalized?.hostname === LEADCAPTURE_HOSTED_PAGE_HOST;
}

/**
 * Resolve the confirmed client association for one incoming LeadCapture event.
 * Read-only: never creates, confirms, or mutates a `SourceFunnel`.
 */
export async function resolveConfirmedLeadCaptureSourceAssociation(
  signals: LeadCaptureSourceIdentitySignals,
  db: PrismaClient | Prisma.TransactionClient = prisma
): Promise<LeadCaptureSourceAssociationResult> {
  if (!hasLeadCaptureSourceIdentitySignals(signals)) {
    return unmatched("no_source_identity");
  }

  for (const providerFunnelId of signals.providerFormIds) {
    const funnel = await findSourceFunnelByProviderId(
      { provider: SOURCE_FUNNEL_LEADCAPTURE_PROVIDER, providerFunnelId },
      db
    );
    if (!funnel) continue;
    const origin = confirmedOriginClientAccountId(funnel);
    if (!origin) return unmatched("source_not_confirmed", [funnel.id]);
    return toMatch(funnel, origin, "provider_form_id", providerFunnelId, signals.routeKey);
  }

  if (signals.parentUrlKey) {
    const funnel = await findSourceFunnelByParentUrlKey(
      { provider: SOURCE_FUNNEL_LEADCAPTURE_PROVIDER, parentUrlKey: signals.parentUrlKey },
      db
    );
    if (funnel) {
      const origin = confirmedOriginClientAccountId(funnel);
      if (!origin) return unmatched("source_not_confirmed", [funnel.id]);
      return toMatch(funnel, origin, "parent_url_key", signals.parentUrlKey, signals.routeKey);
    }
  }

  // Hosted-namespace slug fallback only. A custom domain never matches by slug.
  if (signals.hostedPageSlug) {
    const rows = (
      await listConfirmedSourceFunnelsByPageSlug(
        { provider: SOURCE_FUNNEL_LEADCAPTURE_PROVIDER, pageSlug: signals.hostedPageSlug },
        db
      )
    ).filter(isHostedNamespaceFunnel);
    if (rows.length > 1) {
      return unmatched(
        "ambiguous_hosted_page_slug",
        rows.map((row) => row.id)
      );
    }
    const funnel = rows[0];
    if (funnel) {
      const origin = confirmedOriginClientAccountId(funnel);
      if (origin) {
        return toMatch(
          funnel,
          origin,
          "hosted_page_slug",
          `${LEADCAPTURE_HOSTED_PAGE_HOST} / ${signals.hostedPageSlug}`,
          signals.routeKey
        );
      }
    }
  }

  return unmatched("no_registered_source");
}
