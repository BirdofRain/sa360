/** Same mailbox rule as the notification config API: one lowercase address. */
const RECIPIENT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const NOTIFICATION_ERROR_CODES = [
  "invalid_recipient",
  "invalid_body",
  "revision_conflict",
  "request_id_conflict",
  "recipient_not_verified",
  "client_not_found",
  "team_workspace_disabled",
  "forbidden",
  "unauthorized",
  "not_configured",
  "request_failed",
] as const;

export type NotificationErrorCode = (typeof NOTIFICATION_ERROR_CODES)[number];

export type PreferenceSnapshot = {
  enabled: boolean;
  canEnable: boolean;
  blockedReason: "recipient_not_verified" | null;
  recipientVerified: boolean;
  revision: number;
};

export type RecipientSnapshot = {
  clientAccountId: string;
  recipientEmail: string | null;
  recipientVerified: boolean;
  recipientEmailVerifiedAt: string | null;
  enabled: boolean;
  revision: number;
};

export function normalizeNotificationRecipient(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!RECIPIENT_EMAIL.test(email)) return null;
  if (email.includes(",") || email.includes(";") || email.includes("<") || email.includes(">")) return null;
  return email;
}

export function isNotificationRequestId(value: string): boolean {
  return UUID.test(value);
}

export function isNotificationRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function notificationErrorMessage(code: NotificationErrorCode): string {
  switch (code) {
    case "invalid_recipient":
      return "Enter one email address. A list, a display name, or extra text is not saved.";
    case "invalid_body":
      return "The save could not be read. Check the value and try again.";
    case "revision_conflict":
      return "This record changed somewhere else. The saved values are shown. Nothing was overwritten.";
    case "request_id_conflict":
      return "That save was already used for a different change. The saved values are shown. Try the change again.";
    case "recipient_not_verified":
      return "A verified recipient has to be configured in Admin C.O.C. before this can be turned on.";
    case "client_not_found":
      return "No client matches this id. Nothing was changed.";
    case "team_workspace_disabled":
      return "Delivery notification configuration is turned off. Nothing was saved.";
    case "forbidden":
      return "This session cannot change delivery notifications.";
    case "unauthorized":
      return "Sign in again to continue. Nothing was saved.";
    case "not_configured":
      return "The admin API is not configured for this app. Nothing was saved.";
    case "request_failed":
      return "The save did not finish. Nothing was confirmed. You can retry this save.";
  }
}

export function isRetryableNotificationError(code: NotificationErrorCode): boolean {
  return code === "request_failed" || code === "not_configured";
}

export function readNotificationErrorCode(status: number, body: string): NotificationErrorCode {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string" && isNotificationErrorCode(parsed.error)) return parsed.error;
  } catch {
    // Non-JSON bodies stay a generic failure so tokens and HTML are not shown.
  }
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "client_not_found";
  if (status === 0) return "not_configured";
  return "request_failed";
}

function isNotificationErrorCode(value: string): value is NotificationErrorCode {
  return (NOTIFICATION_ERROR_CODES as readonly string[]).includes(value);
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function timestamp(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function parsePreferenceSnapshot(value: unknown): PreferenceSnapshot | null {
  const row = record(value);
  if (!row) return null;
  if (typeof row.enabled !== "boolean") return null;
  if (typeof row.canEnable !== "boolean") return null;
  if (typeof row.recipientVerified !== "boolean") return null;
  const revision = row.revision;
  if (!isNotificationRevision(revision)) return null;
  const blockedReason =
    row.blockedReason === null
      ? null
      : row.blockedReason === "recipient_not_verified"
        ? "recipient_not_verified"
        : undefined;
  if (blockedReason === undefined) return null;
  if (row.enabled && (!row.canEnable || !row.recipientVerified || blockedReason !== null)) return null;
  if (row.canEnable && !row.recipientVerified) return null;
  if ((row.enabled || row.canEnable || row.recipientVerified) && revision < 1) return null;
  return {
    enabled: row.enabled,
    canEnable: row.canEnable,
    blockedReason,
    recipientVerified: row.recipientVerified,
    revision,
  };
}

/** Preference PUT body has no blockedReason. Map it onto the workspace snapshot. */
export function parsePreferenceWriteSnapshot(value: unknown): { snapshot: PreferenceSnapshot; replayed: boolean } | null {
  const row = record(value);
  if (!row || row.ok !== true) return null;
  if (typeof row.enabled !== "boolean") return null;
  if (typeof row.recipientVerified !== "boolean") return null;
  if (typeof row.replayed !== "boolean") return null;
  const revision = row.revision;
  if (!isNotificationRevision(revision)) return null;
  if (row.channel !== "email") return null;
  if (row.enabled && !row.recipientVerified) return null;
  if ((row.enabled || row.recipientVerified) && revision < 1) return null;
  const recipientVerified = row.recipientVerified;
  return {
    replayed: row.replayed,
    snapshot: {
      enabled: row.enabled,
      canEnable: recipientVerified,
      blockedReason: recipientVerified ? null : "recipient_not_verified",
      recipientVerified,
      revision,
    },
  };
}

export function parseRecipientSnapshot(value: unknown, clientAccountId: string): RecipientSnapshot | null {
  const row = record(value);
  if (!row || row.ok !== true) return null;
  if (row.clientAccountId !== clientAccountId) return null;
  if (row.channel !== "email") return null;
  if (typeof row.recipientVerified !== "boolean") return null;
  if (typeof row.enabled !== "boolean") return null;
  const revision = row.revision;
  if (!isNotificationRevision(revision)) return null;
  const verifiedAt = timestamp(row.recipientEmailVerifiedAt);
  if (row.recipientEmailVerifiedAt !== null && verifiedAt === null) return null;
  let recipientEmail: string | null = null;
  if (row.recipientEmail !== null) {
    if (typeof row.recipientEmail !== "string") return null;
    recipientEmail = normalizeNotificationRecipient(row.recipientEmail);
    if (!recipientEmail || recipientEmail !== row.recipientEmail) return null;
  }
  if (row.recipientVerified && (!recipientEmail || !verifiedAt)) return null;
  if (!row.recipientVerified && row.enabled) return null;
  if ((recipientEmail || row.recipientVerified || row.enabled) && revision < 1) return null;
  return {
    clientAccountId,
    recipientEmail,
    recipientVerified: row.recipientVerified,
    recipientEmailVerifiedAt: verifiedAt,
    enabled: row.enabled,
    revision,
  };
}
