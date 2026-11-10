/**
 * Read-only check of one saved setup request against SourceFunnel and
 * CampaignRoutingRule rows that match its identifiers, including other clients.
 * It does not confirm a source, stamp inventory, or write a routing rule.
 */

import type { PrismaClient } from "@prisma/client";

import { isClientOnboardingSetupEnabled } from "../../lib/client-onboarding-setup-env.js";
import { clientOnboardingSetupDataSchema } from "../../schemas/client-onboarding-setup.schema.js";
import { normalizeLeadCaptureParentUrl } from "../source-intake/leadcapture-parent-url.js";
import {
  reviewSavedSourceCampaignRequest,
  type CampaignRegistryStatus,
  type KnownCampaignRule,
  type KnownSourceFunnel,
  type SourceRegistryStatus,
} from "../source-intake/source-association-request-review.js";
import { TEAM_WORKSPACE_CLIENT_ID } from "./team-workspace-read.js";

const MATCH_LIMIT = 20;

export type SourceCampaignReviewAvailability = "ready" | "unavailable" | "unreadable";

export type SourceCampaignCampaignOwnership = "this_client" | "another_client" | "both" | "none" | "unknown";

export type SourceCampaignReviewBody = {
  ok: true;
  availability: SourceCampaignReviewAvailability;
  revision: number | null;
  requestDisposition: "incomplete" | "saved_request" | "rejected" | "stale" | "duplicate_request" | "unreadable" | "unavailable";
  requested: {
    trafficSourceName: string | null;
    providerFunnelId: string | null;
    providerCampaignId: string | null;
  };
  sourceStatus: SourceRegistryStatus | null;
  campaignStatus: CampaignRegistryStatus | null;
  sourceAssociated: boolean;
  /** This client's matching live rule has deliveryEnabled. Not a delivery receipt. */
  deliveryActivated: boolean;
  /** This read never checks a GoHighLevel or Company Sheets receipt. */
  deliveryConfirmed: false;
  liveRouting: boolean;
  campaignOwnership: SourceCampaignCampaignOwnership;
  attention: string[];
};

type SetupIdentity = {
  trafficSourceName: string | null;
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  providerCampaignId: string | null;
};

function text(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function blank(value: string): string | null {
  return value ? value : null;
}

function emptyRequested(): SourceCampaignReviewBody["requested"] {
  return { trafficSourceName: null, providerFunnelId: null, providerCampaignId: null };
}

function closed(input: {
  availability: SourceCampaignReviewAvailability;
  disposition: SourceCampaignReviewBody["requestDisposition"];
  revision: number | null;
  requested?: SourceCampaignReviewBody["requested"];
  attention: string[];
}): SourceCampaignReviewBody {
  return {
    ok: true,
    availability: input.availability,
    revision: input.revision,
    requestDisposition: input.disposition,
    requested: input.requested ?? emptyRequested(),
    sourceStatus: null,
    campaignStatus: null,
    sourceAssociated: false,
    deliveryActivated: false,
    deliveryConfirmed: false,
    liveRouting: false,
    campaignOwnership: "unknown",
    attention: input.attention,
  };
}

function readIdentity(value: unknown): { readable: true; identity: SetupIdentity } | { readable: false } {
  const parsed = clientOnboardingSetupDataSchema.safeParse(value);
  if (!parsed.success) return { readable: false };
  const data = parsed.data;
  const funnelId = text(data.providerFunnelId);
  const fromUrl = normalizeLeadCaptureParentUrl(data.nextgenFunnelUrl);
  const fromFunnelUrl = funnelId.startsWith("http://") || funnelId.startsWith("https://") ? normalizeLeadCaptureParentUrl(funnelId) : null;
  const parentUrlKey = fromUrl?.parentUrlKey ?? fromFunnelUrl?.parentUrlKey ?? "";
  const providerFunnelId = fromFunnelUrl && !fromUrl ? "" : funnelId;
  return {
    readable: true,
    identity: {
      trafficSourceName: blank(text(data.trafficSourceName)),
      providerFunnelId: blank(providerFunnelId),
      parentUrlKey: blank(parentUrlKey),
      providerCampaignId: blank(text(data.providerCampaignId)),
    },
  };
}

function ruleIsLive(rule: KnownCampaignRule, now: Date): boolean {
  if (!rule.active) return false;
  if (rule.effectiveStart && rule.effectiveStart > now) return false;
  if (rule.effectiveEnd && rule.effectiveEnd < now) return false;
  return true;
}

function ownership(rules: KnownCampaignRule[], clientAccountId: string, now: Date): SourceCampaignCampaignOwnership {
  const live = rules.filter((rule) => ruleIsLive(rule, now));
  const own = live.some((rule) => text(rule.clientAccountId) === clientAccountId);
  const other = live.some((rule) => text(rule.clientAccountId) !== clientAccountId);
  if (own && other) return "both";
  if (own) return "this_client";
  if (other) return "another_client";
  return "none";
}

function attentionFor(input: {
  sourceStatus: SourceRegistryStatus;
  campaignStatus: CampaignRegistryStatus;
  campaignOwnership: SourceCampaignCampaignOwnership;
  deliveryActivated: boolean;
}): string[] {
  const lines: string[] = [];
  if (input.sourceStatus === "incomplete") lines.push("The saved request has no funnel id yet, so the source was not checked.");
  if (input.sourceStatus === "not_registered") lines.push("No source record matches this funnel id.");
  if (input.sourceStatus === "registered_unconfirmed") lines.push("A source record exists, and it is not confirmed for this client. A suggestion is not an association.");
  if (input.sourceStatus === "confirmed_for_other_client") lines.push("A matching source is confirmed for a different client. This check does not move it.");
  if (input.sourceStatus === "ambiguous") lines.push("More than one source record matches. Ownership was not verified.");
  if (input.sourceStatus === "confirmed_for_client") lines.push("The source is confirmed for this client. Associated is not the same as delivery.");
  if (input.campaignStatus === "incomplete") lines.push("The saved request has no campaign id yet, so routing was not checked.");
  if (input.campaignStatus === "no_matching_rule") lines.push("No campaign routing rule uses this campaign id.");
  if (input.campaignStatus === "inactive_rule_only") lines.push("A campaign rule exists, and it is not in live routing.");
  if (input.campaignStatus === "live_routing_rule" && (input.campaignOwnership === "another_client" || input.campaignOwnership === "both")) {
    lines.push("A live routing rule for this campaign id belongs to another client. It was not changed.");
  }
  if (input.campaignStatus === "live_routing_rule" && (input.campaignOwnership === "this_client" || input.campaignOwnership === "both") && !input.deliveryActivated) {
    lines.push("This client has a live routing rule, and delivery is not enabled on it.");
  }
  if (input.deliveryActivated) {
    lines.push("This client's matching rule has delivery enabled. That switch is not proof a lead was delivered.");
  }
  lines.push("Delivery confirmed: no. This check does not read a GoHighLevel or Company Sheets receipt.");
  return lines;
}

export async function readSourceCampaignReview(
  clientAccountId: string,
  db: PrismaClient,
  options: { expectedRevision?: number; now?: Date; env?: NodeJS.ProcessEnv } = {}
): Promise<{ ok: true; body: SourceCampaignReviewBody } | { ok: false; code: "client_not_found"; statusCode: 404 }> {
  if (!TEAM_WORKSPACE_CLIENT_ID.test(clientAccountId)) {
    return { ok: false, code: "client_not_found", statusCode: 404 };
  }
  const client = await db.clientAccount.findUnique({
    where: { clientAccountId },
    select: {
      clientAccountId: true,
      onboardingSetup: { select: { revision: true, setupDataJson: true } },
    },
  });
  if (!client) return { ok: false, code: "client_not_found", statusCode: 404 };

  const setup = client.onboardingSetup;
  const revision = setup && Number.isInteger(setup.revision) ? setup.revision : 0;
  if (!setup) {
    return {
      ok: true,
      body: closed({
        availability: "ready",
        disposition: "incomplete",
        revision: 0,
        attention: ["No setup request is saved yet. Nothing was verified."],
      }),
    };
  }
  if (!isClientOnboardingSetupEnabled(options.env)) {
    return {
      ok: true,
      body: closed({
        availability: "unavailable",
        disposition: "unavailable",
        revision,
        attention: ["The setup request could not be checked because native client setup is turned off. Nothing was verified."],
      }),
    };
  }
  const identity = readIdentity(setup.setupDataJson);
  if (!identity.readable) {
    return {
      ok: true,
      body: closed({
        availability: "unreadable",
        disposition: "unreadable",
        revision,
        attention: ["The saved setup request could not be read. Nothing was verified. Open the client setup screen to recover it."],
      }),
    };
  }
  if (options.expectedRevision !== undefined && options.expectedRevision !== revision) {
    return {
      ok: true,
      body: closed({
        availability: "ready",
        disposition: "stale",
        revision,
        requested: {
          trafficSourceName: identity.identity.trafficSourceName,
          providerFunnelId: identity.identity.providerFunnelId,
          providerCampaignId: identity.identity.providerCampaignId,
        },
        attention: ["The saved request changed. Reload before relying on this check. Nothing was verified."],
      }),
    };
  }

  const now = options.now ?? new Date();
  let funnels: KnownSourceFunnel[] = [];
  let rules: KnownCampaignRule[] = [];
  try {
    const funnelFilters = [
      identity.identity.providerFunnelId ? { providerFunnelId: identity.identity.providerFunnelId } : null,
      identity.identity.parentUrlKey ? { parentUrlKey: identity.identity.parentUrlKey } : null,
    ].filter((item): item is { providerFunnelId: string } | { parentUrlKey: string } => Boolean(item));
    if (funnelFilters.length > 0) {
      funnels = await db.sourceFunnel.findMany({
        where: { OR: funnelFilters },
        select: {
          id: true,
          provider: true,
          providerFunnelId: true,
          parentUrlKey: true,
          pageSlug: true,
          associationStatus: true,
          originClientAccountId: true,
          suggestedClientAccountId: true,
        },
        take: MATCH_LIMIT + 1,
      });
    }
    if (identity.identity.providerCampaignId) {
      rules = await db.campaignRoutingRule.findMany({
        where: { campaignId: identity.identity.providerCampaignId },
        select: {
          id: true,
          clientAccountId: true,
          campaignId: true,
          active: true,
          deliveryEnabled: true,
          effectiveStart: true,
          effectiveEnd: true,
        },
        take: MATCH_LIMIT + 1,
      });
    }
  } catch {
    return {
      ok: true,
      body: closed({
        availability: "unavailable",
        disposition: "unavailable",
        revision,
        requested: {
          trafficSourceName: identity.identity.trafficSourceName,
          providerFunnelId: identity.identity.providerFunnelId,
          providerCampaignId: identity.identity.providerCampaignId,
        },
        attention: ["The source and campaign records could not be loaded. Nothing was verified."],
      }),
    };
  }
  if (funnels.length > MATCH_LIMIT || rules.length > MATCH_LIMIT) {
    return {
      ok: true,
      body: closed({
        availability: "unavailable",
        disposition: "unavailable",
        revision,
        requested: {
          trafficSourceName: identity.identity.trafficSourceName,
          providerFunnelId: identity.identity.providerFunnelId,
          providerCampaignId: identity.identity.providerCampaignId,
        },
        attention: ["Too many matching records were found to verify ownership. Nothing was verified."],
      }),
    };
  }

  const review = reviewSavedSourceCampaignRequest({
    clientAccountId,
    requestId: null,
    requestStatus: "saved",
    loadedRevision: revision,
    currentRevision: revision,
    providerFunnelId: identity.identity.providerFunnelId,
    parentUrlKey: identity.identity.parentUrlKey,
    providerCampaignId: identity.identity.providerCampaignId,
    funnels,
    rules,
    now,
  });
  const campaignOwnership = ownership(rules, clientAccountId, now);
  return {
    ok: true,
    body: {
      ok: true,
      availability: "ready",
      revision,
      requestDisposition: review.requestDisposition,
      requested: {
        trafficSourceName: identity.identity.trafficSourceName,
        providerFunnelId: identity.identity.providerFunnelId,
        providerCampaignId: identity.identity.providerCampaignId,
      },
      sourceStatus: review.sourceStatus,
      campaignStatus: review.campaignStatus,
      sourceAssociated: review.sourceAssociated,
      deliveryActivated: review.deliveryActivated,
      deliveryConfirmed: false,
      liveRouting: review.campaignStatus === "live_routing_rule",
      campaignOwnership,
      attention: attentionFor({
        sourceStatus: review.sourceStatus,
        campaignStatus: review.campaignStatus,
        campaignOwnership,
        deliveryActivated: review.deliveryActivated,
      }),
    },
  };
}
