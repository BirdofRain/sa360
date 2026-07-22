import { prisma } from "../../lib/db.js";

/**
 * Next-Gen one-lead live canary gates (Stage D).
 *
 * Env (presence only — never log secret values):
 * - SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_ENABLED=true
 * - SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_CLIENT_ACCOUNT_ID
 * - SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_CAMPAIGN_ID
 * - SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_MAX_LEADS (default 1)
 * - SA360_LEADCAPTURE_NEXTGEN_LEGACY_PAUSE_CAMPAIGN_IDS (csv)
 */

function parseCsvEnv(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function isLeadCaptureNextGenLiveCanaryEnabled(): boolean {
  const raw = process.env.SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function getNextGenLiveCanaryClientAccountId(): string | null {
  const raw = process.env.SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_CLIENT_ACCOUNT_ID?.trim();
  return raw && raw.length > 0 ? raw : null;
}

export function getNextGenLiveCanaryCampaignId(): string | null {
  const raw = process.env.SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_CAMPAIGN_ID?.trim();
  return raw && raw.length > 0 ? raw : null;
}

export function getNextGenLiveCanaryMaxLeads(): number {
  return parsePositiveInt(process.env.SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_MAX_LEADS, 1);
}

export function getLegacyLeadCapturePausedCampaignIds(): string[] {
  return parseCsvEnv(process.env.SA360_LEADCAPTURE_NEXTGEN_LEGACY_PAUSE_CAMPAIGN_IDS);
}

export function isLegacyLeadCaptureCampaignPausedForNextGen(
  campaignId: string | null | undefined
): boolean {
  const id = campaignId?.trim();
  if (!id) return false;
  const paused = getLegacyLeadCapturePausedCampaignIds();
  return paused.includes(id);
}

export type NextGenLiveCanaryGateResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "live_canary_disabled"
        | "client_not_allowlisted"
        | "campaign_not_allowlisted"
        | "delivery_mode_not_live_canary"
        | "max_leads_reached"
        | "missing_client"
        | "missing_campaign";
    };

const LIVE_CANARY_MARKER = "leadcapture_nextgen_live_canary_attempt";

export async function countNextGenLiveCanaryAttempts(): Promise<number> {
  const rows = await prisma.sourceLeadEvent.count({
    where: {
      sourceSystem: "leadcapture_io_nextgen",
      OR: [
        { status: "delivered" },
        {
          enrichmentMetadataJson: {
            path: ["liveCanaryAttempt"],
            equals: true,
          },
        },
      ],
    },
  });
  return rows;
}

export async function assertNextGenLiveCanaryAllowed(input: {
  sourceLeadEventId: string;
  clientAccountId: string | null;
  campaignId: string;
  deliveryMode: string | null;
}): Promise<NextGenLiveCanaryGateResult> {
  if (!isLeadCaptureNextGenLiveCanaryEnabled()) {
    return { ok: false, reason: "live_canary_disabled" };
  }

  const allowedClient = getNextGenLiveCanaryClientAccountId();
  const allowedCampaign = getNextGenLiveCanaryCampaignId();
  if (!allowedClient) return { ok: false, reason: "missing_client" };
  if (!allowedCampaign) return { ok: false, reason: "missing_campaign" };

  if (!input.clientAccountId || input.clientAccountId.trim() !== allowedClient) {
    return { ok: false, reason: "client_not_allowlisted" };
  }
  if (input.campaignId.trim() !== allowedCampaign) {
    return { ok: false, reason: "campaign_not_allowlisted" };
  }

  const mode = (input.deliveryMode ?? "").trim().toLowerCase();
  if (mode !== "live_canary") {
    return { ok: false, reason: "delivery_mode_not_live_canary" };
  }

  const maxLeads = getNextGenLiveCanaryMaxLeads();
  const attempts = await countNextGenLiveCanaryAttempts();
  if (attempts >= maxLeads) {
    return { ok: false, reason: "max_leads_reached" };
  }

  return { ok: true };
}

/** Mark event as counting toward the one-lead live canary budget (does not execute GHL). */
export async function recordNextGenLiveCanaryDeliveryAttempt(
  sourceLeadEventId: string
): Promise<void> {
  const event = await prisma.sourceLeadEvent.findUnique({ where: { id: sourceLeadEventId } });
  if (!event) return;
  const prior =
    event.enrichmentMetadataJson && typeof event.enrichmentMetadataJson === "object"
      ? (event.enrichmentMetadataJson as Record<string, unknown>)
      : {};
  await prisma.sourceLeadEvent.update({
    where: { id: sourceLeadEventId },
    data: {
      enrichmentMetadataJson: {
        ...prior,
        liveCanaryAttempt: true,
        liveCanaryMarker: LIVE_CANARY_MARKER,
        liveCanaryRecordedAt: new Date().toISOString(),
      },
    },
  });
}

/**
 * Gate used by approve-delivery / live paths for Next-Gen events.
 * Returns null when the event is not Next-Gen (caller continues normally).
 */
export async function evaluateNextGenEventLiveCanaryForDelivery(input: {
  sourceSystem: string;
  sourceLeadEventId: string;
  clientAccountId: string | null;
  campaignId: string | null;
  deliveryMode: string | null;
}): Promise<NextGenLiveCanaryGateResult | null> {
  if (input.sourceSystem !== "leadcapture_io_nextgen") return null;
  return assertNextGenLiveCanaryAllowed({
    sourceLeadEventId: input.sourceLeadEventId,
    clientAccountId: input.clientAccountId,
    campaignId: input.campaignId ?? "",
    deliveryMode: input.deliveryMode,
  });
}
