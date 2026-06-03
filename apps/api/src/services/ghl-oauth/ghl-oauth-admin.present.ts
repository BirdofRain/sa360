import { createGhlOAuthState } from "../../lib/ghl-oauth-state.js";
import {
  getGhlOAuthInstallConfigDebug,
  type GhlOAuthInstallConfigDebug,
} from "../../lib/ghl-oauth-env.js";
import { buildGhlOAuthAuthorizeUrl } from "./ghl-oauth-client.service.js";
import type { GhlOAuthDebugSnapshot } from "./ghl-oauth-debug.service.js";
import type { GhlMarketplaceWebhookSafeSnapshot } from "./ghl-oauth-webhook-debug.service.js";
import type { GhlLocationConnectionItem } from "./ghl-connection.present.js";
import type { GhlOAuthPendingInstallItem } from "./ghl-oauth-pending-install.present.js";

export type GhlLocationDeliveryReadiness =
  | "ready_for_delivery_config"
  | "link_client"
  | "probe_required"
  | "not_delivery_capable";

export type GhlLocationConnectionAdminItem = GhlLocationConnectionItem & {
  deliveryReadinessHint: GhlLocationDeliveryReadiness;
  isTestLocation: boolean;
};

export type GhlOAuthReconciliationSummary = {
  pendingCallbackReceived: boolean;
  installWebhookReconciled: boolean;
  connectedLocationCreated: boolean;
  deliveryCapable: boolean;
  reconciledLocationId: string | null;
  reconcileNote: string | null;
};

export type GhlOAuthPageBannerTone = "success" | "info" | "warn" | "error";

export type GhlOAuthPageBanner = {
  tone: GhlOAuthPageBannerTone;
  message: string;
};

const TEST_LOCATION_PREFIXES = ["loc_unlinked", "loc_inject", "loc_storage_fail"] as const;

const RECONCILED_WEBHOOK_NOTES = [
  "reconciled_from_pending_connected",
  "reconciled_from_pending_pending_token",
] as const;

export function isGhlTestLocationId(locationId: string): boolean {
  const id = locationId.trim();
  return TEST_LOCATION_PREFIXES.some((p) => id.startsWith(p));
}

export function deriveGhlLocationDeliveryReadiness(
  connection: Pick<
    GhlLocationConnectionItem,
    "connectionStatus" | "clientAccountId" | "lastProbeAt" | "locationId"
  >
): GhlLocationDeliveryReadiness {
  const status = connection.connectionStatus;
  if (
    status === "revoked" ||
    status === "error" ||
    status === "pending_token" ||
    status === "pending_location" ||
    isGhlTestLocationId(connection.locationId)
  ) {
    return "not_delivery_capable";
  }
  if (status !== "connected") {
    return "not_delivery_capable";
  }
  if (!connection.lastProbeAt) {
    return "probe_required";
  }
  if (!connection.clientAccountId?.trim()) {
    return "link_client";
  }
  return "ready_for_delivery_config";
}

export function presentGhlLocationConnectionForAdmin(
  connection: GhlLocationConnectionItem
): GhlLocationConnectionAdminItem {
  return {
    ...connection,
    deliveryReadinessHint: deriveGhlLocationDeliveryReadiness(connection),
    isTestLocation: isGhlTestLocationId(connection.locationId),
  };
}

export function getGhlOAuthInstallConfigDebugForAdmin(): GhlOAuthInstallConfigDebug {
  try {
    const sampleState = createGhlOAuthState({ clientAccountId: null });
    const authorizeUrl = buildGhlOAuthAuthorizeUrl(sampleState);
    return getGhlOAuthInstallConfigDebug(authorizeUrl);
  } catch {
    return getGhlOAuthInstallConfigDebug();
  }
}

function isInstallWebhookReconciled(note: string | null | undefined): boolean {
  if (!note) return false;
  return RECONCILED_WEBHOOK_NOTES.some((n) => note.includes(n));
}

function findReconciledConnectedLocation(
  connections: GhlLocationConnectionItem[]
): GhlLocationConnectionItem | null {
  return (
    connections.find(
      (c) => c.connectionStatus === "connected" && Boolean(c.locationId?.trim())
    ) ?? null
  );
}

function hasUnresolvedPending(
  activePending: GhlOAuthPendingInstallItem[],
  connections: GhlLocationConnectionItem[]
): boolean {
  if (activePending.length === 0) return false;
  return !activePending.every((pending) =>
    connections.some(
      (c) =>
        c.connectionStatus === "connected" &&
        ((pending.companyId && c.companyId === pending.companyId) ||
          (pending.userId && c.userId === pending.userId))
    )
  );
}

export function buildGhlOAuthReconciliationSummary(input: {
  latestCallback: GhlOAuthDebugSnapshot | null;
  latestWebhook: GhlMarketplaceWebhookSafeSnapshot | null;
  connections: GhlLocationConnectionItem[];
}): GhlOAuthReconciliationSummary {
  const reconcileNote = input.latestWebhook?.reconcileNote ?? null;
  const installWebhookReconciled = isInstallWebhookReconciled(reconcileNote);
  const connected = findReconciledConnectedLocation(input.connections);
  const pendingCallbackReceived =
    input.latestCallback?.outcome === "pending_location" ||
    Boolean(input.latestCallback?.pendingInstallId);

  return {
    pendingCallbackReceived,
    installWebhookReconciled,
    connectedLocationCreated: Boolean(connected),
    deliveryCapable: input.connections.some(
      (c) => c.connectionStatus === "connected" && Boolean(c.lastProbeAt)
    ),
    reconciledLocationId: connected?.locationId ?? null,
    reconcileNote,
  };
}

export function deriveGhlOAuthPageBanner(input: {
  urlOauth: string | null;
  urlReason: string | null;
  connections: GhlLocationConnectionItem[];
  activePending: GhlOAuthPendingInstallItem[];
  latestCallback: GhlOAuthDebugSnapshot | null;
  latestWebhook: GhlMarketplaceWebhookSafeSnapshot | null;
}): GhlOAuthPageBanner | null {
  const reconciliation = buildGhlOAuthReconciliationSummary({
    latestCallback: input.latestCallback,
    latestWebhook: input.latestWebhook,
    connections: input.connections,
  });

  if (input.urlOauth === "error" || input.latestCallback?.outcome === "token_exchange_failed") {
    const reason = input.urlReason ?? input.latestCallback?.tokenExchangeError ?? "unknown";
    return {
      tone: "error",
      message: `GHL OAuth failed: ${reason}. Verify API env vars and callback URL.`,
    };
  }

  if (
    input.latestCallback?.outcome === "storage_failed" ||
    input.urlReason === "storage_failed"
  ) {
    return {
      tone: "error",
      message:
        "Tokens were received but could not be saved. Check API database connectivity and migrations.",
    };
  }

  if (reconciliation.installWebhookReconciled && reconciliation.connectedLocationCreated) {
    const loc = reconciliation.reconciledLocationId;
    return {
      tone: "success",
      message: loc
        ? `OAuth connected: Marketplace install webhook reconciled subaccount location ${loc}.`
        : "OAuth connected: Marketplace install webhook reconciled the subaccount location.",
    };
  }

  const ready = input.connections.find(
    (c) => deriveGhlLocationDeliveryReadiness(c) === "ready_for_delivery_config"
  );
  if (ready) {
    return {
      tone: "success",
      message:
        "OAuth connection is ready for configuration. Link this location to a client and delivery rule.",
    };
  }

  if (
    hasUnresolvedPending(input.activePending, input.connections) ||
    (input.urlOauth === "pending_location" && !reconciliation.installWebhookReconciled)
  ) {
    return {
      tone: "info",
      message:
        "GHL OAuth tokens saved as pending — awaiting subaccount locationId from marketplace INSTALL webhook.",
    };
  }

  if (input.urlOauth === "connected" || input.urlOauth === "connected_unlinked") {
    return {
      tone: "success",
      message: "GHL OAuth connected successfully. Link the location to a client account if needed.",
    };
  }

  const connectedNeedsProbe = input.connections.find(
    (c) => deriveGhlLocationDeliveryReadiness(c) === "probe_required"
  );
  if (connectedNeedsProbe) {
    return {
      tone: "info",
      message: "OAuth connected. Run Probe on each location before delivery configuration.",
    };
  }

  const needsClient = input.connections.find(
    (c) => deriveGhlLocationDeliveryReadiness(c) === "link_client"
  );
  if (needsClient) {
    return {
      tone: "info",
      message: "OAuth connected. Link each location to a client account to continue setup.",
    };
  }

  return null;
}

export function ghlOAuthReadinessHintLabel(hint: GhlLocationDeliveryReadiness): string {
  switch (hint) {
    case "ready_for_delivery_config":
      return "Ready for delivery config";
    case "link_client":
      return "Link client";
    case "probe_required":
      return "Probe required";
    case "not_delivery_capable":
      return "Not delivery-capable";
  }
}
