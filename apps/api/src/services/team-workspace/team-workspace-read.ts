/**
 * Read-only Team Workspace snapshot.
 * Postgres only. No Google, GoHighLevel, Meta, Resend, or customer webhook call.
 * Canonical receipt classification belongs to the ingestion predicate. This read
 * does not mark a job or a run as canonical, and it does not query models that
 * are not on this baseline.
 */

import type { PrismaClient } from "@prisma/client";

import { clientOnboardingSetupDataSchema } from "../../schemas/client-onboarding-setup.schema.js";

export const TEAM_WORKSPACE_CONTRACT_VERSION = "team_workspace_delivery_v1" as const;

/** Same shape as the onboarding client id: one segment, no dots or slashes. */
export const TEAM_WORKSPACE_CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const DESTINATION_CHOICES = ["ghl", "google_sheets", "both", "intake_only", "undecided"] as const;
const SETUP_STATUSES = ["draft", "submitted", "needs_information", "setup_reviewed"] as const;

type DestinationChoice = (typeof DESTINATION_CHOICES)[number];
type SetupStatus = (typeof SETUP_STATUSES)[number];

export type TeamWorkspaceRead = {
  ok: true;
  contractVersion: typeof TEAM_WORKSPACE_CONTRACT_VERSION;
  client: {
    clientAccountId: string;
    clientDisplayName: string;
    status: string;
  };
  setupRequest: {
    present: boolean;
    status: SetupStatus | null;
    revision: number;
    destinationChoice: DestinationChoice;
    operational: false;
  };
  destinations: {
    ghl: {
      configured: boolean;
      deliveryEnabled: boolean;
      deliveryMode: string | null;
      locationIdPresent: boolean;
    };
    companySheets: {
      configured: boolean;
      campaignDispatchEnabled: boolean;
      campaignDispatchNotBefore: string | null;
      agedDispatchEnabled: boolean;
    };
    customWebhook: {
      present: boolean;
      enabled: boolean;
      endpointHost: string | null;
    };
  };
  recentCanonicalDeliveries: [];
  /**
   * Per-client preference. This is not the process kill switch
   * `SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED`. Until the preference table
   * exists, the read returns the disabled object and does not query one.
   */
  clientNotification: {
    enabled: false;
    canEnable: false;
    blockedReason: "recipient_not_verified";
    recipientVerified: false;
  };
  notifications: {
    items: [];
  };
};

export type TeamWorkspaceReadFailure = {
  ok: false;
  code: "client_not_found";
  statusCode: 404;
};

type WebhookTargetRow = {
  enabled: boolean;
  configMetadataJson: unknown;
};

/** Exact `true` after trim. `TRUE`, `1`, `yes`, and `on` stay off. */
export function isTeamWorkspaceApiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_TEAM_WORKSPACE_ENABLED?.trim() === "true";
}

/**
 * Disabled until `ClientDeliveryNotificationPreference` is on master.
 * The process kill switch is not consulted and is not returned.
 */
const CLIENT_NOTIFICATION_UNAVAILABLE = {
  enabled: false,
  canEnable: false,
  blockedReason: "recipient_not_verified",
  recipientVerified: false,
} as const;

function isDestinationChoice(value: unknown): value is DestinationChoice {
  return typeof value === "string" && (DESTINATION_CHOICES as readonly string[]).includes(value);
}

function isSetupStatus(value: unknown): value is SetupStatus {
  return typeof value === "string" && (SETUP_STATUSES as readonly string[]).includes(value);
}

/**
 * The stored setup document is the source of the destination enum.
 * A strict parse wins. A failed parse may still expose that one enum.
 * Phone, email, URL, and every other key stay out of the response.
 */
export function readDestinationChoice(value: unknown): DestinationChoice {
  const parsed = clientOnboardingSetupDataSchema.safeParse(value);
  if (parsed.success && isDestinationChoice(parsed.data.destinationChoice)) {
    return parsed.data.destinationChoice;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return "undecided";
  const raw = (value as Record<string, unknown>).destinationChoice;
  return isDestinationChoice(raw) ? raw : "undecided";
}

/** Hostname only. The URL, userinfo, path, query, and secret-looking keys are dropped. */
export function readEndpointHost(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const raw = (metadata as Record<string, unknown>).endpointUrl;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.trim().toLowerCase();
  if (!host || !/^(?=.{1,253}$)[a-z0-9.-]+$/.test(host)) return null;
  if (host === "." || host.startsWith(".") || host.endsWith(".")) return null;
  return host;
}

function isoTimestamp(value: Date | null | undefined): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

function webhookSummary(targets: WebhookTargetRow[]): TeamWorkspaceRead["destinations"]["customWebhook"] {
  const present = targets.length > 0;
  const enabled = targets.some((target) => target.enabled === true);
  const preferred = targets.find((target) => target.enabled) ?? targets[0];
  return {
    present,
    enabled,
    endpointHost: preferred ? readEndpointHost(preferred.configMetadataJson) : null,
  };
}

export async function readTeamWorkspaceClient(
  clientAccountId: string,
  db: PrismaClient
): Promise<{ ok: true; body: TeamWorkspaceRead } | TeamWorkspaceReadFailure> {
  if (!TEAM_WORKSPACE_CLIENT_ID.test(clientAccountId)) {
    return { ok: false, code: "client_not_found", statusCode: 404 };
  }

  const client = await db.clientAccount.findUnique({
    where: { clientAccountId },
    select: {
      clientAccountId: true,
      clientDisplayName: true,
      status: true,
      onboardingSetup: {
        select: {
          status: true,
          revision: true,
          setupDataJson: true,
        },
      },
      ghlDestination: {
        select: {
          deliveryEnabled: true,
          deliveryMode: true,
          destinationSubaccountIdGhl: true,
        },
      },
      companySheetsDestination: {
        select: {
          campaignDispatchEnabled: true,
          campaignDispatchNotBefore: true,
          agedDispatchEnabled: true,
        },
      },
      deliveryTargets: {
        where: { adapterKey: "webhook.generic.v1" },
        select: {
          enabled: true,
          configMetadataJson: true,
        },
      },
    },
  });

  if (!client) return { ok: false, code: "client_not_found", statusCode: 404 };

  const setup = client.onboardingSetup;
  const ghl = client.ghlDestination;
  const sheets = client.companySheetsDestination;
  const locationIdPresent =
    typeof ghl?.destinationSubaccountIdGhl === "string" && ghl.destinationSubaccountIdGhl.trim().length > 0;

  const body: TeamWorkspaceRead = {
    ok: true,
    contractVersion: TEAM_WORKSPACE_CONTRACT_VERSION,
    client: {
      clientAccountId: client.clientAccountId,
      clientDisplayName: client.clientDisplayName,
      status: client.status,
    },
    setupRequest: {
      present: Boolean(setup),
      status: setup && isSetupStatus(setup.status) ? setup.status : null,
      revision: setup && Number.isInteger(setup.revision) ? setup.revision : 0,
      destinationChoice: setup ? readDestinationChoice(setup.setupDataJson) : "undecided",
      operational: false,
    },
    destinations: {
      ghl: {
        configured: Boolean(ghl),
        deliveryEnabled: ghl?.deliveryEnabled === true,
        deliveryMode: typeof ghl?.deliveryMode === "string" && ghl.deliveryMode.trim() ? ghl.deliveryMode : null,
        locationIdPresent,
      },
      companySheets: {
        configured: Boolean(sheets),
        campaignDispatchEnabled: sheets?.campaignDispatchEnabled === true,
        campaignDispatchNotBefore: isoTimestamp(sheets?.campaignDispatchNotBefore),
        agedDispatchEnabled: sheets?.agedDispatchEnabled === true,
      },
      customWebhook: webhookSummary(client.deliveryTargets),
    },
    recentCanonicalDeliveries: [],
    clientNotification: CLIENT_NOTIFICATION_UNAVAILABLE,
    notifications: {
      items: [],
    },
  };

  return { ok: true, body };
}
