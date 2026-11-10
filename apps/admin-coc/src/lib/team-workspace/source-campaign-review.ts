/**
 * Present the read-only source and campaign check.
 * Requested, associated, routing configured, delivery enabled, and delivery
 * confirmed stay separate. This module does not confirm a source or write a rule.
 */

export type SourceCampaignReviewView = {
  availability: "ready" | "unavailable" | "unreadable";
  disposition: "incomplete" | "saved_request" | "rejected" | "stale" | "duplicate_request" | "unreadable" | "unavailable";
  revision: number | null;
  requested: {
    trafficSourceName: string | null;
    providerFunnelId: string | null;
    providerCampaignId: string | null;
  };
  sourceStatus: "incomplete" | "not_registered" | "registered_unconfirmed" | "confirmed_for_client" | "confirmed_for_other_client" | "ambiguous" | null;
  campaignStatus: "incomplete" | "no_matching_rule" | "inactive_rule_only" | "live_routing_rule" | null;
  sourceAssociated: boolean;
  deliveryActivated: boolean;
  deliveryConfirmed: false;
  liveRouting: boolean;
  campaignOwnership: "this_client" | "another_client" | "both" | "none" | "unknown";
  attention: string[];
};

const NOT_A_VERIFICATION = "Not checked. This is not a verification.";
const DELIVERY_CONFIRMED = "No. This check does not read a GoHighLevel or Company Sheets receipt.";

const SOURCE_STATUSES = new Set(["incomplete", "not_registered", "registered_unconfirmed", "confirmed_for_client", "confirmed_for_other_client", "ambiguous"]);
const CAMPAIGN_STATUSES = new Set(["incomplete", "no_matching_rule", "inactive_rule_only", "live_routing_rule"]);
const AVAILABILITY = new Set(["ready", "unavailable", "unreadable"]);
const DISPOSITIONS = new Set(["incomplete", "saved_request", "rejected", "stale", "duplicate_request", "unreadable", "unavailable"]);
const OWNERSHIP = new Set(["this_client", "another_client", "both", "none", "unknown"]);

export function unavailableSourceCampaignReview(attention: string): SourceCampaignReviewView {
  return {
    availability: "unavailable",
    disposition: "unavailable",
    revision: null,
    requested: { trafficSourceName: null, providerFunnelId: null, providerCampaignId: null },
    sourceStatus: null,
    campaignStatus: null,
    sourceAssociated: false,
    deliveryActivated: false,
    deliveryConfirmed: false,
    liveRouting: false,
    campaignOwnership: "unknown",
    attention: [attention],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullableText(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

export function parseSourceCampaignReview(value: unknown): SourceCampaignReviewView | null {
  if (!isRecord(value) || value.ok !== true || value.deliveryConfirmed !== false) return null;
  if (typeof value.availability !== "string" || !AVAILABILITY.has(value.availability)) return null;
  if (typeof value.requestDisposition !== "string" || !DISPOSITIONS.has(value.requestDisposition)) return null;
  if (typeof value.campaignOwnership !== "string" || !OWNERSHIP.has(value.campaignOwnership)) return null;
  if (!isRecord(value.requested)) return null;
  const trafficSourceName = nullableText(value.requested.trafficSourceName);
  const providerFunnelId = nullableText(value.requested.providerFunnelId);
  const providerCampaignId = nullableText(value.requested.providerCampaignId);
  if (trafficSourceName === undefined || providerFunnelId === undefined || providerCampaignId === undefined) return null;
  if (value.revision !== null && (typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 0)) return null;
  if (value.sourceStatus !== null && (typeof value.sourceStatus !== "string" || !SOURCE_STATUSES.has(value.sourceStatus))) return null;
  if (value.campaignStatus !== null && (typeof value.campaignStatus !== "string" || !CAMPAIGN_STATUSES.has(value.campaignStatus))) return null;
  if (!Array.isArray(value.attention) || value.attention.some((line) => typeof line !== "string")) return null;

  const availability = value.availability as SourceCampaignReviewView["availability"];
  const disposition = value.requestDisposition as SourceCampaignReviewView["disposition"];
  const trustworthy = availability === "ready" && (disposition === "saved_request" || disposition === "incomplete");
  const sourceStatus = trustworthy ? (value.sourceStatus as SourceCampaignReviewView["sourceStatus"]) : null;
  const campaignStatus = trustworthy ? (value.campaignStatus as SourceCampaignReviewView["campaignStatus"]) : null;
  const campaignOwnership = trustworthy ? (value.campaignOwnership as SourceCampaignReviewView["campaignOwnership"]) : "unknown";
  const liveRouting = trustworthy && value.liveRouting === true && campaignStatus === "live_routing_rule";
  const sourceAssociated = trustworthy && value.sourceAssociated === true && sourceStatus === "confirmed_for_client";
  const deliveryActivated =
    trustworthy &&
    value.deliveryActivated === true &&
    liveRouting &&
    (campaignOwnership === "this_client" || campaignOwnership === "both");

  return {
    availability,
    disposition,
    revision: value.revision,
    requested: { trafficSourceName, providerFunnelId, providerCampaignId },
    sourceStatus,
    campaignStatus,
    sourceAssociated,
    deliveryActivated,
    deliveryConfirmed: false,
    liveRouting,
    campaignOwnership,
    attention: value.attention.map((line) => line.trim()).filter(Boolean).slice(0, 12),
  };
}

export type SourceCampaignReviewPresentation = {
  requested: string;
  sourceRegistered: string;
  sourceOwnership: string;
  conflicts: string;
  campaignRule: string;
  liveRouting: string;
  deliveryEnabled: string;
  deliveryConfirmed: string;
  attention: string[];
  unsavedNote: string | null;
  next: { href: string; label: string } | null;
};

function requestedLine(view: SourceCampaignReviewView): string {
  const funnel = view.requested.providerFunnelId ?? "none saved";
  const campaign = view.requested.providerCampaignId ?? "none saved";
  const name = view.requested.trafficSourceName ? ` Source name: ${view.requested.trafficSourceName}.` : "";
  return `Funnel id: ${funnel}. Campaign id: ${campaign}.${name}`;
}

function closedPresentation(view: SourceCampaignReviewView, unsavedNote: string | null, next: { href: string; label: string } | null): SourceCampaignReviewPresentation {
  return {
    requested: view.requested.providerFunnelId || view.requested.providerCampaignId ? requestedLine(view) : "No saved identifiers were read.",
    sourceRegistered: NOT_A_VERIFICATION,
    sourceOwnership: "Not confirmed. This is not a verification.",
    conflicts: NOT_A_VERIFICATION,
    campaignRule: NOT_A_VERIFICATION,
    liveRouting: NOT_A_VERIFICATION,
    deliveryEnabled: NOT_A_VERIFICATION,
    deliveryConfirmed: DELIVERY_CONFIRMED,
    attention: view.attention,
    unsavedNote,
    next,
  };
}

export function presentSourceCampaignReview(
  view: SourceCampaignReviewView,
  clientAccountId: string,
  draft: { providerFunnelId: string; providerCampaignId: string } | null = null
): SourceCampaignReviewPresentation {
  const unsaved =
    draft &&
    ((draft.providerFunnelId.trim() || null) !== view.requested.providerFunnelId ||
      (draft.providerCampaignId.trim() || null) !== view.requested.providerCampaignId)
      ? "Unsaved edits in the form are not part of this check. Save the request first if you want those identifiers checked."
      : null;
  const trustworthy = view.availability === "ready" && (view.disposition === "saved_request" || view.disposition === "incomplete");
  if (!trustworthy) {
    const next =
      view.availability === "unreadable" || view.disposition === "unreadable"
        ? { href: `/clients/${clientAccountId}/onboarding`, label: "Open the client setup screen to recover the request" }
        : view.disposition === "stale" || view.availability === "unavailable"
          ? { href: `/team-workspace/${clientAccountId}?guide=sources`, label: "Reload this page" }
          : null;
    return closedPresentation(view, unsaved, next);
  }

  const source = view.sourceStatus;
  const campaign = view.campaignStatus;
  const otherCampaign = view.campaignOwnership === "another_client" || view.campaignOwnership === "both";
  const sourceRegistered =
    source === "incomplete"
      ? "Not checked. The saved request has no funnel id."
      : source === "not_registered"
        ? "No. No source record matches the requested funnel id."
        : source === "ambiguous"
          ? "Not established. More than one source record matches."
          : "Yes. A source record matches the requested funnel id.";
  const sourceOwnership = view.sourceAssociated
    ? "Confirmed for this client."
    : source === "registered_unconfirmed"
      ? "Not confirmed. The matching record is only a suggestion."
      : source === "confirmed_for_other_client"
        ? "Not confirmed for this client. It is confirmed for a different client."
        : source === "ambiguous"
          ? "Not confirmed. The records do not agree on one owner."
          : source === "not_registered"
            ? "Not confirmed. There is no matching source record."
            : source === "incomplete"
              ? "Not checked. The saved request has no funnel id."
              : "Not confirmed.";
  const conflictParts = [
    source === "ambiguous" ? "The matching source records do not agree on one owner." : null,
    source === "confirmed_for_other_client" ? "The matching source belongs to another client." : null,
    otherCampaign ? "A live campaign rule for this campaign id belongs to another client." : null,
  ].filter((part): part is string => Boolean(part));

  const needsClientScreen =
    source === "not_registered" ||
    source === "registered_unconfirmed" ||
    source === "confirmed_for_other_client" ||
    source === "ambiguous" ||
    campaign === "no_matching_rule" ||
    campaign === "inactive_rule_only" ||
    otherCampaign ||
    (view.liveRouting && !view.deliveryActivated);

  return {
    requested: requestedLine(view),
    sourceRegistered,
    sourceOwnership,
    conflicts: conflictParts.length > 0 ? conflictParts.join(" ") : "None found.",
    campaignRule:
      campaign === "incomplete"
        ? "Not checked. The saved request has no campaign id."
        : campaign === "no_matching_rule"
          ? "No. No campaign routing rule uses this campaign id."
          : campaign === "inactive_rule_only"
            ? "A rule exists, and it is not in live routing."
            : "Yes. A matching campaign rule exists.",
    liveRouting:
      !view.liveRouting
        ? "No."
        : view.campaignOwnership === "another_client"
          ? "A rule for another client is in live routing. This client's routing is not configured by that rule."
          : view.campaignOwnership === "both"
            ? "Rules for this client and another client are in live routing."
            : "Yes. This client's matching rule is in live routing.",
    deliveryEnabled: view.deliveryActivated
      ? "Yes, on this client's matching rule. That switch is not proof a lead was delivered."
      : view.liveRouting && (view.campaignOwnership === "this_client" || view.campaignOwnership === "both")
        ? "No. This client's matching rule does not have delivery enabled."
        : otherCampaign
          ? "No. Another client's rule does not enable delivery for this client."
          : "No.",
    deliveryConfirmed: DELIVERY_CONFIRMED,
    attention: view.attention,
    unsavedNote: unsaved,
    next: needsClientScreen
      ? { href: `/clients/${clientAccountId}`, label: "Open the client screen to review sources and campaign rules" }
      : null,
  };
}
