export type CustomerNotificationWire = {
  status: string;
  reason?: string;
};

export type CustomerReleaseNotificationKind =
  | "sent"
  | "pending"
  | "failed"
  | "skipped"
  | "no_intent"
  | "unknown";

export type CustomerReleaseNotificationView = {
  kind: CustomerReleaseNotificationKind;
  headline: string;
  explanation: string | null;
  action: string | null;
};

export const RELEASE_NOTIFY_COPY = {
  sent: "Customer email sent",
  pending: "Customer email pending",
  failed: "Customer email was not sent",
  skipped: "No automated notification",
  noIntent: "No automated notification",
  unknown: "Customer notification status unavailable",
  notifyManually: "Notify customer manually",
  noIntentExplanation: "This package was released before automated notification.",
  skipReasons: {
    missing_portal_login_email: "No portal login email on this client account.",
    invalid_portal_login_email: "Portal login email is not a valid address.",
    missing_client_account: "Client account was not found.",
  },
} as const;

const SKIP_REASON_COPY: Record<string, string> = RELEASE_NOTIFY_COPY.skipReasons;

const PENDING_STATUSES = new Set(["in_progress", "pending", "sending"]);

function readStatus(input: CustomerNotificationWire | null | undefined): string | null {
  if (!input || typeof input !== "object") return null;
  if (typeof input.status !== "string") return null;
  const status = input.status.trim().toLowerCase();
  return status.length > 0 ? status : null;
}

function readReason(input: CustomerNotificationWire | null | undefined): string | null {
  if (!input || typeof input !== "object") return null;
  if (typeof input.reason !== "string") return null;
  const reason = input.reason.trim();
  return reason.length > 0 ? reason : null;
}

function skipExplanation(reason: string | null): string | null {
  if (!reason) return null;
  return SKIP_REASON_COPY[reason] ?? null;
}

/** Operator-safe presentation of Approve & Release customerNotification. Never echoes raw reasons. */
export function mapCustomerReleaseNotification(
  input?: CustomerNotificationWire | null
): CustomerReleaseNotificationView {
  const status = readStatus(input);
  const reason = readReason(input);

  if (status === "sent" || status === "already_sent") {
    return {
      kind: "sent",
      headline: RELEASE_NOTIFY_COPY.sent,
      explanation: null,
      action: null,
    };
  }

  if (status && PENDING_STATUSES.has(status)) {
    return {
      kind: "pending",
      headline: RELEASE_NOTIFY_COPY.pending,
      explanation: null,
      action: null,
    };
  }

  if (status === "failed") {
    return {
      kind: "failed",
      headline: RELEASE_NOTIFY_COPY.failed,
      explanation: null,
      action: RELEASE_NOTIFY_COPY.notifyManually,
    };
  }

  if (status === "skipped") {
    return {
      kind: "skipped",
      headline: RELEASE_NOTIFY_COPY.skipped,
      explanation: skipExplanation(reason),
      action: RELEASE_NOTIFY_COPY.notifyManually,
    };
  }

  if (status === "no_intent") {
    return {
      kind: "no_intent",
      headline: RELEASE_NOTIFY_COPY.noIntent,
      explanation: RELEASE_NOTIFY_COPY.noIntentExplanation,
      action: RELEASE_NOTIFY_COPY.notifyManually,
    };
  }

  return {
    kind: "unknown",
    headline: RELEASE_NOTIFY_COPY.unknown,
    explanation: null,
    action: null,
  };
}

export function releaseNotificationRenderedText(
  view: CustomerReleaseNotificationView
): string {
  return [view.headline, view.explanation, view.action].filter(Boolean).join("\n");
}
