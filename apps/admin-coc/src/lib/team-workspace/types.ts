import type { TeamWorkspaceStepId } from "./contract";

export type TeamWorkspaceStepStatus = "complete" | "blocked" | "unavailable" | "pending";

export type DestinationChoice = "ghl" | "google_sheets" | "both" | "intake_only" | "undecided";

export type TeamWorkspaceCanonicalDelivery = {
  channel: "company_sheets" | "ghl_location_api";
  receiptId: string;
  sourceLeadEventId: string | null;
  canonical: true;
  at: string;
};

/** Fields the read route is allowed to show. Extra API fields are dropped. */
export type TeamWorkspaceRead = {
  ok: true;
  contractVersion: "team_workspace_delivery_v1";
  client: {
    clientAccountId: string;
    clientDisplayName: string;
    status: string;
  };
  setupRequest: {
    present: boolean;
    status: string | null;
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
  recentCanonicalDeliveries: TeamWorkspaceCanonicalDelivery[];
  clientNotification: {
    enabled: boolean;
    canEnable: boolean;
    blockedReason: "recipient_not_verified" | null;
    recipientVerified: boolean;
  };
  notifications: {
    items: [];
  };
};

export type ClientOption = {
  clientAccountId: string;
  clientDisplayName: string;
  status: string;
};

export type RoutingRuleSummary = {
  label: string;
  active: boolean;
};

export type TeamWorkspaceStep = {
  id: TeamWorkspaceStepId;
  title: string;
  status: TeamWorkspaceStepStatus;
  summary: string;
  details: string[];
};

export type TeamWorkspaceReceipts = {
  sourceLeadEventId: string | null;
  sheetsJobId: string | null;
  ghlLiveRunId: string | null;
  customWebhookAttemptId: string | null;
};

export type TeamWorkspaceClientView = {
  clientAccountId: string;
  clientDisplayName: string;
  accountStatus: string;
  setupLine: string;
  banner: { tone: "info" | "warn"; title: string; body: string } | null;
  showRetry: boolean;
  retryHref: string;
  recordedCount: number;
  steps: TeamWorkspaceStep[];
  receipts: TeamWorkspaceReceipts;
  /** Saved per-client choice. The control stays disabled because this page does not write it. */
  notificationChoiceOn: boolean;
};

export type TeamWorkspaceIndexModel =
  | { kind: "disabled" }
  | { kind: "error"; message: string }
  | { kind: "ready"; clients: ClientOption[] };

export type TeamWorkspaceDetailModel =
  | { kind: "disabled" }
  | { kind: "invalid_client" }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; view: TeamWorkspaceClientView; clients: ClientOption[] };

export type WorkspaceAvailability =
  | { availability: "ready"; body: TeamWorkspaceRead }
  | { availability: "disabled" }
  | { availability: "not_found" }
  | { availability: "forbidden" }
  | { availability: "error"; code: string };

export type AccountSlice =
  | { loaded: true; clientDisplayName: string; status: string; rules: RoutingRuleSummary[] }
  | { loaded: false };

export type OnboardingSlice =
  | { availability: "ready"; linkedSources: number; blockers: string[] }
  | { availability: "unavailable" }
  | { availability: "error" };
