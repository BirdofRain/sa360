import { TEAM_WORKSPACE_CONTRACT_VERSION, isSafeTeamWorkspaceId } from "./contract";
import type { DestinationChoice, TeamWorkspaceCanonicalDelivery, TeamWorkspaceRead } from "./types";

const DESTINATION_CHOICES = ["ghl", "google_sheets", "both", "intake_only", "undecided"] as const;
const SAFE_CODE = /^[a-z0-9_]{1,80}$/;
const SAFE_HOST = /^(?=.{1,253}$)[a-z0-9.-]+$/;
const SAFE_STATUS = /^[a-z_]{1,40}$/;
const SAFE_MODE = /^[a-z0-9_]{1,40}$/;

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function flag(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function choice(value: unknown): DestinationChoice | null {
  return typeof value === "string" && (DESTINATION_CHOICES as readonly string[]).includes(value)
    ? (value as DestinationChoice)
    : null;
}

function host(value: unknown): string | null {
  if (value === null) return null;
  const raw = text(value, 253);
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (!SAFE_HOST.test(normalized) || normalized.startsWith(".") || normalized.endsWith(".")) return null;
  if (normalized.includes("://") || normalized.includes("/") || normalized.includes("@")) return null;
  return normalized;
}

function timestamp(value: unknown): string | null {
  const raw = text(value, 40);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function delivery(value: unknown): TeamWorkspaceCanonicalDelivery | null {
  const row = record(value);
  if (!row || row.canonical !== true) return null;
  if (row.channel !== "company_sheets" && row.channel !== "ghl_location_api") return null;
  if (!isSafeTeamWorkspaceId(row.receiptId)) return null;
  const sourceLeadEventId = row.sourceLeadEventId === null ? null : isSafeTeamWorkspaceId(row.sourceLeadEventId) ? row.sourceLeadEventId : null;
  if (row.sourceLeadEventId !== null && sourceLeadEventId === null) return null;
  const at = timestamp(row.at);
  if (!at) return null;
  return {
    channel: row.channel,
    receiptId: row.receiptId,
    sourceLeadEventId,
    canonical: true,
    at,
  };
}

/**
 * Keeps the closed read contract. URLs, secrets, phones, and notification
 * payloads are not copied onto the view model.
 */
export function parseTeamWorkspaceResponse(data: unknown): TeamWorkspaceRead | null {
  const body = record(data);
  if (!body || body.ok !== true || body.contractVersion !== TEAM_WORKSPACE_CONTRACT_VERSION) return null;

  const client = record(body.client);
  const setup = record(body.setupRequest);
  const destinations = record(body.destinations);
  const ghl = record(destinations?.ghl);
  const sheets = record(destinations?.companySheets);
  const webhook = record(destinations?.customWebhook);
  const notifications = record(body.notifications);
  const preference = record(body.clientNotification);
  if (!client || !setup || !ghl || !sheets || !webhook || !notifications || !preference) return null;
  if (!isSafeTeamWorkspaceId(client.clientAccountId)) return null;
  const clientDisplayName = text(client.clientDisplayName, 200);
  const status = text(client.status, 40);
  if (!clientDisplayName || !status || !SAFE_STATUS.test(status)) return null;
  if (setup.operational !== false) return null;
  const destinationChoice = choice(setup.destinationChoice);
  const present = flag(setup.present);
  const revision = setup.revision;
  if (!destinationChoice || present === null || typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
    return null;
  }
  const setupStatus = setup.status === null ? null : text(setup.status, 40);
  if (setup.status !== null && (setupStatus === null || !SAFE_STATUS.test(setupStatus))) return null;

  const ghlConfigured = flag(ghl.configured);
  const deliveryEnabled = flag(ghl.deliveryEnabled);
  const locationIdPresent = flag(ghl.locationIdPresent);
  const sheetsConfigured = flag(sheets.configured);
  const campaignDispatchEnabled = flag(sheets.campaignDispatchEnabled);
  const agedDispatchEnabled = flag(sheets.agedDispatchEnabled);
  const webhookPresent = flag(webhook.present);
  const webhookEnabled = flag(webhook.enabled);
  const preferenceEnabled = flag(preference.enabled);
  const canEnable = flag(preference.canEnable);
  const recipientVerified = flag(preference.recipientVerified);
  const preferenceRevision = preference.revision;
  const blockedReason =
    preference.blockedReason === null
      ? null
      : preference.blockedReason === "recipient_not_verified"
        ? "recipient_not_verified"
        : undefined;
  if (
    ghlConfigured === null ||
    deliveryEnabled === null ||
    locationIdPresent === null ||
    sheetsConfigured === null ||
    campaignDispatchEnabled === null ||
    agedDispatchEnabled === null ||
    webhookPresent === null ||
    webhookEnabled === null ||
    preferenceEnabled === null ||
    canEnable === null ||
    recipientVerified === null ||
    typeof preferenceRevision !== "number" ||
    !Number.isSafeInteger(preferenceRevision) ||
    preferenceRevision < 0 ||
    blockedReason === undefined ||
    !Array.isArray(notifications.items) ||
    !Array.isArray(body.recentCanonicalDeliveries)
  ) {
    return null;
  }
  if (preferenceEnabled && (!canEnable || !recipientVerified || blockedReason !== null)) return null;
  if (canEnable && !recipientVerified) return null;
  if ((preferenceEnabled || canEnable || recipientVerified) && preferenceRevision < 1) return null;

  const deliveryMode = ghl.deliveryMode === null ? null : text(ghl.deliveryMode, 40);
  if (ghl.deliveryMode !== null && (deliveryMode === null || !SAFE_MODE.test(deliveryMode))) return null;
  const campaignDispatchNotBefore =
    sheets.campaignDispatchNotBefore === null ? null : timestamp(sheets.campaignDispatchNotBefore);
  if (sheets.campaignDispatchNotBefore !== null && campaignDispatchNotBefore === null) return null;
  const endpointHost = host(webhook.endpointHost);
  if (webhook.endpointHost !== null && endpointHost === null) return null;

  const recentCanonicalDeliveries = body.recentCanonicalDeliveries
    .map(delivery)
    .filter((item): item is TeamWorkspaceCanonicalDelivery => item !== null)
    .slice(0, 20);

  return {
    ok: true,
    contractVersion: TEAM_WORKSPACE_CONTRACT_VERSION,
    client: {
      clientAccountId: client.clientAccountId,
      clientDisplayName,
      status,
    },
    setupRequest: {
      present,
      status: setupStatus,
      revision,
      destinationChoice,
      operational: false,
    },
    destinations: {
      ghl: { configured: ghlConfigured, deliveryEnabled, deliveryMode, locationIdPresent },
      companySheets: {
        configured: sheetsConfigured,
        campaignDispatchEnabled,
        campaignDispatchNotBefore,
        agedDispatchEnabled,
      },
      customWebhook: { present: webhookPresent, enabled: webhookEnabled, endpointHost },
    },
    recentCanonicalDeliveries,
    clientNotification: {
      enabled: preferenceEnabled,
      canEnable,
      blockedReason,
      recipientVerified,
      revision: preferenceRevision,
    },
    notifications: { items: [] },
  };
}

export function readAdminErrorCode(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string" && SAFE_CODE.test(parsed.error)) return parsed.error;
  } catch {
    // Non-JSON bodies stay a generic code so tokens and HTML are not shown.
  }
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 0) return "not_configured";
  return "request_failed";
}
