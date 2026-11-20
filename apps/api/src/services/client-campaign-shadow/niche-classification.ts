/**
 * Incoming niche evidence for shadow classification.
 *
 * The saved campaign nicheKey is the expected classification.
 * Explicit integration fields can agree or conflict with it.
 * Funnel-name parsing, route-key tokens, and consumer answers are recorded
 * and are not agreement or conflict evidence.
 * FEX and VET stay distinct. vet_fex follows the existing inventory alias to VET.
 * This module does not write SourceFunnel or the live niche resolver result.
 */

import { canonicalizeCommerceNicheKey, normalizeCommerceNicheToken } from "@sa360/shared";

import { isCampaignNicheKey } from "../client-campaign-registry/identity.js";
import { parseLeadCaptureFunnelNameNiche } from "../source-intake/leadcapture-funnel-name-niche.js";
import {
  parseTrustedLeadCaptureRouteNiche,
  resolveLeadCaptureNiche,
} from "../source-intake/leadcapture-niche-resolver.js";

export type NicheClassificationStatus = "MATCH" | "MISSING" | "CONFLICT" | "UNRESOLVED";

export type TrustedNicheProvenance = "niche_key" | "sa360_niche_key" | "classification" | "niche";

export type UntrustedNicheObservation = {
  provenance: "funnel_form_name" | "route_key";
  rawValue: string;
  normalizedKey: string | null;
};

export type IncomingNicheEvidence = {
  trustedProvenance: TrustedNicheProvenance | "none";
  trustedRawValue: string | null;
  trustedNormalizedKey: string | null;
  unrecognized: boolean;
  untrustedObservations: UntrustedNicheObservation[];
  ignoredConsumerAnswer: boolean;
};

const TRUSTED_FIELDS: Array<{
  provenance: TrustedNicheProvenance;
  read: (root: Record<string, unknown>, classification: Record<string, unknown> | null) => unknown;
}> = [
  { provenance: "niche_key", read: (root) => root.niche_key },
  { provenance: "sa360_niche_key", read: (root) => root.sa360_niche_key },
  { provenance: "classification", read: (_root, classification) => classification?.niche_key },
  { provenance: "classification", read: (_root, classification) => classification?.sa360_niche_key },
  { provenance: "classification", read: (_root, classification) => classification?.niche },
  { provenance: "niche", read: (root) => root.niche },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function trim(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Map one explicit token onto the campaign catalog.
 * Catalog keys win before aliases, so FEX is not rewritten to VET.
 * MORTGAGE is the LeadCapture label for the stored MTG key.
 */
export function normalizeCatalogNicheKey(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (isCampaignNicheKey(upper)) return upper;
  if (upper === "MORTGAGE") return "MTG";

  const token = normalizeCommerceNicheToken(trimmed);
  const tokenUpper = token.toUpperCase();
  if (isCampaignNicheKey(tokenUpper)) return tokenUpper;
  if (tokenUpper === "MORTGAGE") return "MTG";

  const resolved = resolveLeadCaptureNiche({ niche_key: token });
  if (resolved.nicheKey === "MORTGAGE") return "MTG";
  if (resolved.nicheKey && isCampaignNicheKey(resolved.nicheKey)) return resolved.nicheKey;

  const commerce = canonicalizeCommerceNicheKey(token);
  if (commerce === "vet") return "VET";
  if (commerce === "nurse") return "NURSE";
  if (commerce === "trucker") return "TRUCKER";
  return null;
}

function consumerAnswerPresent(root: Record<string, unknown>): boolean {
  for (const containerKey of ["answers", "form"] as const) {
    const container = asRecord(root[containerKey]);
    if (!container) continue;
    for (const key of ["niche_key", "sa360_niche_key", "niche", "sa360_campaign_lead_type"]) {
      if (trim(container[key])) return true;
    }
  }
  return false;
}

function firstTrusted(root: Record<string, unknown>): { provenance: TrustedNicheProvenance; raw: string } | null {
  const classification = asRecord(root.classification);
  for (const field of TRUSTED_FIELDS) {
    const raw = trim(field.read(root, classification));
    if (raw) return { provenance: field.provenance, raw };
  }
  return null;
}

function untrustedObservations(
  raw: Record<string, unknown> | null,
  normalized: Record<string, unknown> | null,
  routeKey: string | null
): UntrustedNicheObservation[] {
  const observations: UntrustedNicheObservation[] = [];
  const routing = asRecord(normalized?.routing);
  const intake = asRecord(routing?.source_intake);
  const labels = [
    raw?.funnel_name,
    raw?.sa360_funnel_name,
    raw?.form_name,
    raw?.sa360_form_name,
    raw?.campaign_name,
    raw?.sa360_campaign_name,
    intake?.funnel_name,
    intake?.form_name,
    intake?.campaign_name,
  ];
  for (const label of labels) {
    const parsed = parseLeadCaptureFunnelNameNiche(label);
    const rawValue = trim(label);
    if (!parsed || !rawValue) continue;
    observations.push({
      provenance: "funnel_form_name",
      rawValue,
      normalizedKey:
        parsed.recognizedNicheKey === "MORTGAGE" ? "MTG" : (parsed.recognizedNicheKey ?? null),
    });
    break;
  }
  const route = trim(routeKey) ?? trim(raw?.sa360_route_key) ?? trim(raw?.sourceRouteKey);
  const fromRoute = parseTrustedLeadCaptureRouteNiche(route);
  if (fromRoute) {
    observations.push({
      provenance: "route_key",
      rawValue: route ?? fromRoute,
      normalizedKey: fromRoute === "MORTGAGE" ? "MTG" : fromRoute,
    });
  }
  return observations;
}

export function readIncomingNicheEvidence(input: {
  rawPayload: unknown;
  normalizedPayload: unknown;
  routeKey?: string | null;
}): IncomingNicheEvidence {
  const raw = asRecord(input.rawPayload);
  const normalized = asRecord(input.normalizedPayload);
  const trusted = firstTrusted(raw ?? {}) ?? firstTrusted(normalized ?? {});
  const normalizedKey = trusted ? normalizeCatalogNicheKey(trusted.raw) : null;
  return {
    trustedProvenance: trusted?.provenance ?? "none",
    trustedRawValue: trusted?.raw ?? null,
    trustedNormalizedKey: normalizedKey,
    unrecognized: Boolean(trusted && !normalizedKey),
    untrustedObservations: untrustedObservations(raw, normalized, input.routeKey ?? null),
    ignoredConsumerAnswer: consumerAnswerPresent(raw ?? {}) || consumerAnswerPresent(normalized ?? {}),
  };
}

export function classifyCampaignNiche(input: {
  configuredNicheKey: string | null;
  incoming: IncomingNicheEvidence;
}): { status: NicheClassificationStatus; reasonCodes: string[] } {
  if (!input.configuredNicheKey) return { status: "UNRESOLVED", reasonCodes: [] };
  const expected = normalizeCatalogNicheKey(input.configuredNicheKey);
  if (!expected) return { status: "UNRESOLVED", reasonCodes: [] };
  if (input.incoming.trustedNormalizedKey === expected) return { status: "MATCH", reasonCodes: [] };
  if (input.incoming.trustedNormalizedKey && input.incoming.trustedNormalizedKey !== expected) {
    return { status: "CONFLICT", reasonCodes: ["niche_classification_conflict"] };
  }
  if (input.incoming.unrecognized) {
    return { status: "MISSING", reasonCodes: ["incoming_niche_unrecognized"] };
  }
  return { status: "MISSING", reasonCodes: ["incoming_niche_missing"] };
}
