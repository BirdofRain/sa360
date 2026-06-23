import {
  isDirectDemoDestinationAllowed,
  isDirectLiveDeliveryEnvConfigured,
} from "../lib/direct-demo-delivery-config.js";
import { findClientAccountById } from "../repositories/client-account.repository.js";
import { listCampaignRoutingRules } from "../repositories/campaign-routing-rule.repository.js";
import type { ClientGhlDestinationDto } from "./client-onboarding.present.js";
import type { DestinationReadinessAssessment } from "./destination-readiness.service.js";
import {
  presentRoutingRulesWithReadinessEnriched,
  type RoutingRuleWithReadinessItem,
} from "./delivery-readiness-admin.present.js";
import { getClientDeliveryConfigSummary } from "./ghl-config-discovery/client-ghl-config.service.js";

/**
 * Read-only cutover readiness report. This module never mutates client data,
 * environment variables, cutover flags, or triggers delivery. It only aggregates
 * existing configuration and readiness signals so operators can see what is
 * present and what blocks a manual cutover.
 */

export type CutoverChecklistItem = {
  key: string;
  label: string;
  complete: boolean;
  detail?: string;
};

export type CutoverSectionKey =
  | "client_account"
  | "ghl_destination"
  | "routing_rules"
  | "portal_access"
  | "delivery_readiness"
  | "environment";

export type CutoverReadinessSection = {
  key: CutoverSectionKey;
  label: string;
  complete: boolean;
  items: CutoverChecklistItem[];
};

export type ClientCutoverOverallStatus =
  | "not_ready"
  | "ready_for_shadow"
  | "ready_for_live_review"
  | "blocked";

export type ClientCutoverReadinessReport = {
  clientAccountId: string;
  clientDisplayName: string;
  status: string;
  generatedAt: string;
  overallStatus: ClientCutoverOverallStatus;
  sections: CutoverReadinessSection[];
  blockers: string[];
  warnings: string[];
  manualNextSteps: string[];
};

export type ClientCutoverReadinessInput = {
  client: {
    clientAccountId: string;
    clientDisplayName: string;
    status: string;
    portalEnabled: boolean;
    portalLoginEmail: string | null;
  };
  ghlDestination: ClientGhlDestinationDto | null;
  destinationReadiness: DestinationReadinessAssessment | null;
  locationId: string | null;
  routingRules: RoutingRuleWithReadinessItem[];
  /** True when both SA360_DIRECT_DELIVERY_ALLOWED_* env vars are set. */
  envAllowlistConfigured: boolean;
  /** True when this client/location pair is on the live delivery allowlist. */
  destinationAllowlisted: boolean;
};

function trimmed(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

function buildClientAccountSection(
  client: ClientCutoverReadinessInput["client"]
): CutoverReadinessSection {
  const items: CutoverChecklistItem[] = [
    {
      key: "client_exists",
      label: "Client account exists",
      complete: true,
      detail: client.clientAccountId,
    },
    {
      key: "status_not_archived",
      label: "Client status is not archived",
      complete: client.status !== "archived",
      detail: client.status,
    },
  ];
  return {
    key: "client_account",
    label: "Client account",
    complete: items.every((i) => i.complete),
    items,
  };
}

function buildGhlDestinationSection(
  input: ClientCutoverReadinessInput
): CutoverReadinessSection {
  if (!input.ghlDestination || !input.destinationReadiness) {
    return {
      key: "ghl_destination",
      label: "GHL destination",
      complete: false,
      items: [
        {
          key: "destination_configured",
          label: "GHL destination configured",
          complete: false,
          detail: input.locationId
            ? `location ${input.locationId} not saved to client destination`
            : "no GHL location linked",
        },
      ],
    };
  }
  const readiness = input.destinationReadiness;
  const items: CutoverChecklistItem[] = readiness.checklist.map((c) => ({
    key: c.key,
    label: c.label,
    complete: c.complete,
    detail: c.detail,
  }));
  return {
    key: "ghl_destination",
    label: "GHL destination",
    complete: readiness.readyForSimulation,
    items,
  };
}

function buildRoutingRulesSection(
  rules: RoutingRuleWithReadinessItem[]
): CutoverReadinessSection {
  const activeRules = rules.filter((r) => r.active);
  const activeWithDestination = activeRules.filter((r) =>
    Boolean(trimmed(r.destinationSubaccountIdGhl))
  );
  const masters = [...new Set(activeRules.map((r) => r.masterClientAccountId))];
  const items: CutoverChecklistItem[] = [
    {
      key: "active_rule_exists",
      label: "At least one active routing rule",
      complete: activeRules.length > 0,
      detail: `${activeRules.length} active of ${rules.length} total`,
    },
    {
      key: "rule_destination_set",
      label: "Active rules have a destination subaccount",
      complete:
        activeRules.length > 0 && activeWithDestination.length === activeRules.length,
      detail:
        activeRules.length === 0
          ? "no active rules"
          : `${activeWithDestination.length}/${activeRules.length} rules have destinationSubaccountIdGhl`,
    },
    {
      key: "rule_master_source",
      label: "Master lead source mapped",
      complete: masters.length > 0,
      detail: masters.length > 0 ? masters.join(", ") : "no master source",
    },
  ];
  return {
    key: "routing_rules",
    label: "Routing rules",
    complete: items.every((i) => i.complete),
    items,
  };
}

function buildPortalSection(
  client: ClientCutoverReadinessInput["client"]
): CutoverReadinessSection {
  const loginEmail = trimmed(client.portalLoginEmail);
  const items: CutoverChecklistItem[] = [
    {
      key: "portal_enabled",
      label: "Portal access enabled",
      complete: client.portalEnabled,
      detail: client.portalEnabled ? "enabled" : "not enabled (manual go-live step)",
    },
    {
      key: "portal_login_email",
      label: "Portal login email set",
      complete: Boolean(loginEmail),
      detail: loginEmail ?? "missing",
    },
  ];
  return {
    key: "portal_access",
    label: "Portal access",
    complete: items.every((i) => i.complete),
    items,
  };
}

function buildDeliveryReadinessSection(
  rules: RoutingRuleWithReadinessItem[]
): CutoverReadinessSection {
  const activeRules = rules.filter((r) => r.active);
  const allCutoverApproved =
    activeRules.length > 0 && activeRules.every((r) => r.clientCutoverApproved);
  const allInternalApproved =
    activeRules.length > 0 && activeRules.every((r) => r.internalApprovalStatus === "approved");
  const allLiveEnabled =
    activeRules.length > 0 &&
    activeRules.every((r) => r.deliveryEnabled && r.deliveryMode === "live");
  const items: CutoverChecklistItem[] = [
    {
      key: "internal_approval",
      label: "Internal approval granted (manual)",
      complete: allInternalApproved,
      detail: activeRules.length === 0 ? "no active rules" : undefined,
    },
    {
      key: "client_cutover_approved",
      label: "Client cutover approved (manual)",
      complete: allCutoverApproved,
      detail: activeRules.length === 0 ? "no active rules" : undefined,
    },
    {
      key: "delivery_enabled_live",
      label: "Delivery enabled in live mode (manual)",
      complete: allLiveEnabled,
      detail: activeRules.length === 0 ? "no active rules" : undefined,
    },
  ];
  return {
    key: "delivery_readiness",
    label: "Delivery readiness",
    complete: items.every((i) => i.complete),
    items,
  };
}

function buildEnvironmentSection(
  input: ClientCutoverReadinessInput
): CutoverReadinessSection {
  const items: CutoverChecklistItem[] = [
    {
      key: "env_allowlist_configured",
      label: "Live delivery env allowlist configured (manual deploy step)",
      complete: input.envAllowlistConfigured,
      detail: input.envAllowlistConfigured
        ? "SA360_DIRECT_DELIVERY_ALLOWED_* set"
        : "SA360_DIRECT_DELIVERY_ALLOWED_* not set (defaults to demo only)",
    },
    {
      key: "destination_allowlisted",
      label: "Client/location on live delivery allowlist",
      complete: input.destinationAllowlisted,
      detail: input.locationId
        ? input.destinationAllowlisted
          ? "on allowlist"
          : "not on allowlist"
        : "no location to check",
    },
  ];
  return {
    key: "environment",
    label: "Environment",
    complete: items.every((i) => i.complete),
    items,
  };
}

export function buildClientCutoverReadinessReport(
  input: ClientCutoverReadinessInput,
  now: Date = new Date()
): ClientCutoverReadinessReport {
  const clientSection = buildClientAccountSection(input.client);
  const ghlSection = buildGhlDestinationSection(input);
  const rulesSection = buildRoutingRulesSection(input.routingRules);
  const portalSection = buildPortalSection(input.client);
  const deliverySection = buildDeliveryReadinessSection(input.routingRules);
  const envSection = buildEnvironmentSection(input);

  const sections = [
    clientSection,
    ghlSection,
    rulesSection,
    portalSection,
    deliverySection,
    envSection,
  ];

  const activeRules = input.routingRules.filter((r) => r.active);
  const loginEmail = trimmed(input.client.portalLoginEmail);

  const blockers: string[] = [];
  const warnings: string[] = [];
  const manualNextSteps: string[] = [];

  if (!input.ghlDestination || !input.destinationReadiness) {
    blockers.push("GHL destination is not configured for this client.");
    manualNextSteps.push(
      "Connect a GHL location and save destination config on the client delivery-config page."
    );
  } else {
    for (const b of input.destinationReadiness.blockers) {
      blockers.push(`Destination: ${b}`);
    }
    for (const w of input.destinationReadiness.warnings) {
      warnings.push(`Destination: ${w}`);
    }
    if (input.destinationReadiness.blockers.length > 0) {
      manualNextSteps.push(
        "Resolve destination readiness blockers on the client delivery-config page."
      );
    }
  }

  if (activeRules.length === 0) {
    blockers.push("No active routing rule maps a master source to this client.");
    manualNextSteps.push("Create an active routing rule for this client.");
  }

  if (input.client.portalEnabled && !loginEmail) {
    blockers.push("Portal is enabled but no portalLoginEmail is set.");
    manualNextSteps.push("Set portalLoginEmail on the client profile.");
  } else if (!input.client.portalEnabled) {
    warnings.push("Portal access is not enabled (manual go-live step).");
    manualNextSteps.push("Enable portal access on the client profile when ready (manual).");
  }

  const ruleHasBlockedApproval = activeRules.some(
    (r) => r.internalApprovalStatus === "blocked"
  );
  for (const rule of activeRules) {
    if (!rule.clientCutoverApproved) {
      warnings.push(`Rule ${rule.id}: client cutover not approved (manual step).`);
    }
    if (rule.internalApprovalStatus !== "approved") {
      warnings.push(
        `Rule ${rule.id}: internal approval is ${rule.internalApprovalStatus} (manual step).`
      );
    }
    if (!(rule.deliveryEnabled && rule.deliveryMode === "live")) {
      warnings.push(`Rule ${rule.id}: live delivery not enabled (manual step).`);
    }
  }
  if (activeRules.length > 0 && !deliverySection.complete) {
    manualNextSteps.push(
      "Review and approve cutover on the Delivery Readiness page (manual operator step)."
    );
  }

  if (!input.envAllowlistConfigured) {
    warnings.push(
      "Live delivery env allowlist is not configured (SA360_DIRECT_DELIVERY_ALLOWED_*)."
    );
    manualNextSteps.push(
      "Set SA360_DIRECT_DELIVERY_ALLOWED_* env vars at deploy time (manual)."
    );
  } else if (input.locationId && !input.destinationAllowlisted) {
    warnings.push("This client/location is not on the live delivery allowlist.");
  }

  manualNextSteps.push(
    "Run a live canary for one test lead from the Direct Delivery Demo page (manual operator step)."
  );

  const configReady =
    blockers.length === 0 &&
    ghlSection.complete &&
    rulesSection.complete;

  const liveReviewReady =
    configReady &&
    deliverySection.complete &&
    envSection.complete &&
    portalSection.complete;

  let overallStatus: ClientCutoverOverallStatus;
  if (ruleHasBlockedApproval) {
    overallStatus = "blocked";
  } else if (!configReady) {
    overallStatus = "not_ready";
  } else if (liveReviewReady) {
    overallStatus = "ready_for_live_review";
  } else {
    overallStatus = "ready_for_shadow";
  }

  return {
    clientAccountId: input.client.clientAccountId,
    clientDisplayName: input.client.clientDisplayName,
    status: input.client.status,
    generatedAt: now.toISOString(),
    overallStatus,
    sections,
    blockers,
    warnings,
    manualNextSteps,
  };
}

export async function getClientCutoverReadiness(
  clientAccountId: string
): Promise<ClientCutoverReadinessReport | { notFound: true }> {
  const client = await findClientAccountById(clientAccountId.trim());
  if (!client) return { notFound: true };

  const summary = await getClientDeliveryConfigSummary(client.clientAccountId);
  const deliverySummary = "notFound" in summary ? null : summary;

  const rules = await listCampaignRoutingRules({ clientAccountId: client.clientAccountId });
  const routingRules = await presentRoutingRulesWithReadinessEnriched(rules);

  const locationId =
    deliverySummary?.locationId ??
    client.ghlDestination?.destinationSubaccountIdGhl ??
    null;

  return buildClientCutoverReadinessReport({
    client: {
      clientAccountId: client.clientAccountId,
      clientDisplayName: client.clientDisplayName,
      status: client.status,
      portalEnabled: client.portalEnabled,
      portalLoginEmail: client.portalLoginEmail,
    },
    ghlDestination: deliverySummary?.ghlDestination ?? null,
    destinationReadiness: deliverySummary?.destinationReadiness ?? null,
    locationId,
    routingRules,
    envAllowlistConfigured: isDirectLiveDeliveryEnvConfigured(),
    destinationAllowlisted: isDirectDemoDestinationAllowed(client.clientAccountId, locationId),
  });
}
