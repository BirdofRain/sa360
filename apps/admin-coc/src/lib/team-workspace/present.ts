import { isSafeTeamWorkspaceId } from "./contract";
import type {
  AccountSlice,
  ClientOption,
  OnboardingSlice,
  RoutingRuleSummary,
  TeamWorkspaceClientView,
  TeamWorkspaceDetailModel,
  TeamWorkspaceNotificationChoice,
  TeamWorkspaceRead,
  TeamWorkspaceReceipts,
  TeamWorkspaceStep,
  TeamWorkspaceStepStatus,
  WorkspaceAvailability,
} from "./types";

const STEP_TITLES = {
  client_information: "Client information",
  lead_source: "Lead source / campaigns",
  delivery_destination: "Lead delivery destination",
  delivery_notifications: "Delivery notifications",
  setup_verification: "Setup verification",
  completion: "Completion / activation status",
} as const;

const CHOICE_LABEL = {
  ghl: "GoHighLevel",
  google_sheets: "Company Google Sheets",
  both: "GoHighLevel and Company Google Sheets",
  intake_only: "Intake only",
  undecided: "Not chosen",
} as const;

export type AssembleInput = {
  clientAccountId: string;
  clients: ClientOption[];
  workspace: WorkspaceAvailability;
  account: AccountSlice;
  onboarding: OnboardingSlice;
};

function step(
  id: TeamWorkspaceStep["id"],
  status: TeamWorkspaceStepStatus,
  summary: string,
  details: string[]
): TeamWorkspaceStep {
  return { id, title: STEP_TITLES[id], status, summary, details };
}

export function projectRoutingRules(
  rules: {
    campaignName?: string | null;
    utmCampaign?: string | null;
    matchType?: string | null;
    active?: boolean;
  }[]
): RoutingRuleSummary[] {
  return rules.slice(0, 12).map((rule) => ({
    label: safeLabel(rule.campaignName) ?? safeLabel(rule.utmCampaign) ?? safeLabel(rule.matchType) ?? "Campaign rule",
    active: rule.active === true,
  }));
}

function safeLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > 120) return null;
  if (/https?:|@|token|secret|password/i.test(trimmed)) return null;
  return trimmed;
}

export function projectClientOptions(
  items: { clientAccountId?: string | null; clientDisplayName?: string | null; status?: string | null }[]
): ClientOption[] {
  const options: ClientOption[] = [];
  for (const item of items) {
    if (!isSafeTeamWorkspaceId(item.clientAccountId)) continue;
    const name = safeLabel(item.clientDisplayName) ?? item.clientAccountId;
    const status = safeLabel(item.status) ?? "onboarding";
    options.push({ clientAccountId: item.clientAccountId, clientDisplayName: name, status });
  }
  return options;
}

function receiptsFrom(body: TeamWorkspaceRead | null): TeamWorkspaceReceipts {
  const deliveries = body?.recentCanonicalDeliveries ?? [];
  const sheets = deliveries.find((item) => item.channel === "company_sheets");
  const ghl = deliveries.find((item) => item.channel === "ghl_location_api");
  const source = deliveries.find((item) => item.sourceLeadEventId);
  return {
    sourceLeadEventId: source?.sourceLeadEventId ?? null,
    sheetsJobId: sheets?.receiptId ?? null,
    ghlLiveRunId: ghl?.receiptId ?? null,
    customWebhookAttemptId: null,
  };
}

function setupLine(workspace: WorkspaceAvailability): string {
  if (workspace.availability !== "ready") {
    return workspace.availability === "disabled"
      ? "Setup request: unavailable. The Team Workspace read is turned off."
      : "Setup request: unavailable.";
  }
  const setup = workspace.body.setupRequest;
  if (!setup.present) return "Setup request: none. It is not an operational switch.";
  const status = setup.status ?? "unreadable";
  return `Setup request: ${status.replace(/_/g, " ")}. Revision ${setup.revision}. It is not an operational switch.`;
}

function clientInformation(name: string, status: string): TeamWorkspaceStep {
  return step("client_information", "complete", `${name} is the selected client.`, [
    `Account status: ${status}.`,
    "This is the client account. It is not a delivery activation.",
  ]);
}

function leadSource(input: AssembleInput): TeamWorkspaceStep {
  const rules = input.account.loaded ? input.account.rules : [];
  const linked = input.onboarding.availability === "ready" ? input.onboarding.linkedSources : 0;
  const needsInformation =
    input.workspace.availability === "ready" &&
    input.workspace.body.setupRequest.present &&
    input.workspace.body.setupRequest.status === "needs_information";

  if (!input.account.loaded && input.onboarding.availability !== "ready") {
    return step("lead_source", "unavailable", "Campaign rules and lead-source proof could not be read.", [
      "Nothing was changed.",
    ]);
  }
  if (rules.length === 0 && linked === 0 && needsInformation) {
    return step("lead_source", "blocked", "Setup is waiting on information, and no campaign rule is saved.", [
      "No linked lead source was reported.",
    ]);
  }
  if (rules.length === 0 && linked === 0) {
    return step("lead_source", "pending", "No campaign rule or linked lead source is saved.", [
      input.account.loaded ? "The client account has no campaign rule." : "Campaign rules could not be read.",
      input.onboarding.availability === "ready"
        ? "Onboarding did not report a linked source."
        : "Onboarding source proof is unavailable.",
    ]);
  }
  const details = [
    rules.length > 0 ? `${rules.length} campaign rule${rules.length === 1 ? "" : "s"} saved.` : "No campaign rule is saved.",
    linked > 0 ? `${linked} linked lead source${linked === 1 ? "" : "s"} reported.` : "No linked lead source was reported.",
    "A saved source does not start delivery.",
  ];
  if (!input.account.loaded) details.unshift("Campaign rules could not be read.");
  return step("lead_source", "complete", "A lead source or campaign rule is on the client.", details.concat(rules.map((rule) => rule.label)));
}

function deliveryDestination(workspace: WorkspaceAvailability): TeamWorkspaceStep {
  if (workspace.availability !== "ready") {
    const summary =
      workspace.availability === "disabled"
        ? "Delivery choices are unavailable because the Team Workspace read is turned off."
        : "Delivery choices could not be read.";
    return step("delivery_destination", "unavailable", summary, ["This page did not invent a destination."]);
  }
  const { setupRequest, destinations } = workspace.body;
  const choice = setupRequest.destinationChoice;
  const details = [
    `Requested destination: ${CHOICE_LABEL[choice]}.`,
    `GoHighLevel row: ${destinations.ghl.configured ? "saved" : "not saved"}. Live delivery: ${destinations.ghl.deliveryEnabled ? "on" : "off"}.`,
    `Company Sheets row: ${destinations.companySheets.configured ? "saved" : "not saved"}. Campaign dispatch: ${destinations.companySheets.campaignDispatchEnabled ? "on" : "off"}.`,
    destinations.customWebhook.present
      ? `Custom webhook target: saved. Enabled: ${destinations.customWebhook.enabled ? "yes" : "no"}. Host: ${destinations.customWebhook.endpointHost ?? "not available"}. A target is not a sent delivery.`
      : "Custom webhook target: not saved. The sender is not available.",
  ];
  const ghlReady = destinations.ghl.configured;
  const sheetsReady = destinations.companySheets.configured;
  if (choice === "intake_only") {
    return step("delivery_destination", "complete", "Intake only was requested. No delivery destination is required.", details);
  }
  if (choice === "undecided" && !ghlReady && !sheetsReady) {
    return step("delivery_destination", "pending", "A delivery destination has not been chosen.", details);
  }
  if (choice === "undecided") {
    return step(
      "delivery_destination",
      "pending",
      "A destination row exists, and the setup request has not chosen one.",
      details
    );
  }
  const missingGhl = (choice === "ghl" || choice === "both") && !ghlReady;
  const missingSheets = (choice === "google_sheets" || choice === "both") && !sheetsReady;
  if (missingGhl || missingSheets) {
    return step("delivery_destination", "blocked", "The requested destination is not saved yet.", details);
  }
  return step(
    "delivery_destination",
    "complete",
    "The requested destination is saved. Saving it does not arm delivery.",
    details
  );
}

const NOTIFICATION_UNREADABLE: TeamWorkspaceNotificationChoice = {
  enabled: false,
  canEnable: false,
  blockedReason: "recipient_not_verified",
  recipientVerified: false,
  revision: 0,
  readable: false,
};

function notificationChoice(workspace: WorkspaceAvailability): TeamWorkspaceNotificationChoice {
  if (workspace.availability !== "ready") return NOTIFICATION_UNREADABLE;
  const preference = workspace.body.clientNotification;
  return {
    enabled: preference.enabled,
    canEnable: preference.canEnable,
    blockedReason: preference.blockedReason,
    recipientVerified: preference.recipientVerified,
    revision: preference.revision,
    readable: true,
  };
}

/**
 * The per-client choice. A missing or unverified recipient stays off.
 * The control can save on or off only. It does not carry the mailbox.
 */
function notifications(workspace: WorkspaceAvailability): TeamWorkspaceStep {
  if (workspace.availability !== "ready") {
    return step(
      "delivery_notifications",
      "unavailable",
      "Notify this client when a lead is successfully delivered is off.",
      [
        "The preference could not be read. It stays off on this page.",
        "This page does not collect an email address and does not send email.",
      ]
    );
  }
  const preference = workspace.body.clientNotification;
  if (preference.enabled) {
    return step(
      "delivery_notifications",
      "pending",
      "Notify this client when a lead is successfully delivered is on.",
      [
        "A verified recipient is saved in Admin C.O.C.",
        "This page does not show that address and does not send email.",
        "This is the saved client preference. It does not activate production delivery notifications.",
        "Turning this on or off does not arm delivery.",
      ]
    );
  }
  if (preference.canEnable && preference.recipientVerified) {
    return step(
      "delivery_notifications",
      "pending",
      "Notify this client when a lead is successfully delivered is off.",
      [
        "A verified recipient is saved in Admin C.O.C.",
        "This page does not show that address and does not send email.",
        "This is the saved client preference. It does not activate production delivery notifications.",
        "Turning this on or off does not arm delivery.",
      ]
    );
  }
  return step(
    "delivery_notifications",
    "unavailable",
    "Notify this client when a lead is successfully delivered is off.",
    [
      "A verified recipient has to be configured in Admin C.O.C. before this can be turned on.",
      "This page does not collect an email address and does not send email.",
      "Turning this on or off does not arm delivery.",
    ]
  );
}

function verification(input: AssembleInput): TeamWorkspaceStep {
  if (input.workspace.availability !== "ready") {
    return step("setup_verification", "unavailable", "Setup verification is unavailable until the Team Workspace read succeeds.", [
      "This page does not confirm a live delivery.",
    ]);
  }
  const setup = input.workspace.body.setupRequest;
  const setupDetail = setup.present
    ? `Setup request status: ${(setup.status ?? "unreadable").replace(/_/g, " ")}.`
    : "No setup request is saved.";
  const receiptDetail =
    input.workspace.body.recentCanonicalDeliveries.length > 0
      ? "A receipt id is listed for support. This page still does not call that a completed activation."
      : "No canonical receipt is listed. An empty list is not a successful or failed delivery.";

  if (setup.present && setup.status === "needs_information") {
    return step("setup_verification", "blocked", "Setup is waiting on information.", [setupDetail, receiptDetail]);
  }
  if (input.onboarding.availability === "unavailable") {
    return step("setup_verification", "unavailable", "Onboarding readiness is turned off, so this step is not verified.", [
      setupDetail,
      receiptDetail,
    ]);
  }
  if (input.onboarding.availability === "error") {
    return step("setup_verification", "unavailable", "Onboarding readiness could not be loaded.", [setupDetail, receiptDetail]);
  }
  if (input.onboarding.blockers.length > 0) {
    return step(
      "setup_verification",
      "blocked",
      "Onboarding reported a blocker. This page did not clear it.",
      [setupDetail, ...input.onboarding.blockers.map((blocker) => blocker.replace(/_/g, " ")), receiptDetail]
    );
  }
  return step(
    "setup_verification",
    "pending",
    "No onboarding blocker was reported. This page does not confirm a live delivery.",
    [setupDetail, receiptDetail]
  );
}

function completion(destination: TeamWorkspaceStep, accountStatus: string): TeamWorkspaceStep {
  const details = [
    `Client account status: ${accountStatus}.`,
    "operational: false. This workspace does not activate delivery.",
  ];
  if (destination.status === "unavailable") {
    return step("completion", "unavailable", "Activation cannot be judged until the destination can be read.", details);
  }
  if (destination.status === "blocked") {
    return step("completion", "blocked", "The requested destination is not saved. This page cannot activate delivery.", details);
  }
  return step("completion", "pending", "Delivery stays inactive here. The setup request is not an operational switch.", details);
}

export function presentTeamWorkspace(input: AssembleInput, identity: { name: string; status: string }): TeamWorkspaceClientView {
  const destination = deliveryDestination(input.workspace);
  const steps = [
    clientInformation(identity.name, identity.status),
    leadSource(input),
    destination,
    notifications(input.workspace),
    verification(input),
    completion(destination, identity.status),
  ];
  const showRetry =
    input.workspace.availability === "error" ||
    input.onboarding.availability === "error" ||
    !input.account.loaded;
  const banner =
    input.workspace.availability === "disabled"
      ? {
          tone: "info" as const,
          title: "Team Workspace read is turned off",
          body: "The client account can still be shown. Destination, notification, and verification details from that read are unavailable.",
        }
      : input.workspace.availability === "error"
        ? {
            tone: "warn" as const,
            title: "Team Workspace could not be loaded",
            body: "Nothing was saved. Try again when the read is available.",
          }
        : null;

  return {
    clientAccountId: input.clientAccountId,
    clientDisplayName: identity.name,
    accountStatus: identity.status,
    setupLine: setupLine(input.workspace),
    banner,
    showRetry,
    retryHref: `/team-workspace/${input.clientAccountId}`,
    recordedCount: steps.filter((item) => item.status === "complete").length,
    steps,
    receipts: receiptsFrom(input.workspace.availability === "ready" ? input.workspace.body : null),
    notification: notificationChoice(input.workspace),
  };
}

export function assembleTeamWorkspaceDetail(input: AssembleInput): TeamWorkspaceDetailModel {
  if (input.workspace.availability === "forbidden") return { kind: "forbidden" };
  if (input.workspace.availability === "not_found") return { kind: "not_found" };

  const fromWorkspace = input.workspace.availability === "ready" ? input.workspace.body.client : null;
  const fromAccount = input.account.loaded
    ? { clientDisplayName: input.account.clientDisplayName, status: input.account.status }
    : null;

  if (!fromWorkspace && !fromAccount) {
    return {
      kind: "error",
      message:
        input.workspace.availability === "disabled"
          ? "This client could not be loaded."
          : "Team Workspace could not be loaded.",
    };
  }

  if (fromWorkspace && fromWorkspace.clientAccountId !== input.clientAccountId) {
    return { kind: "error", message: "Team Workspace returned a different client. Nothing was changed." };
  }

  const identity = {
    name: fromWorkspace?.clientDisplayName ?? fromAccount?.clientDisplayName ?? input.clientAccountId,
    status: fromWorkspace?.status ?? fromAccount?.status ?? "onboarding",
  };
  const view = presentTeamWorkspace(input, identity);
  const clients =
    input.clients.length > 0
      ? input.clients
      : [{ clientAccountId: input.clientAccountId, clientDisplayName: identity.name, status: identity.status }];
  return { kind: "ready", view, clients };
}
