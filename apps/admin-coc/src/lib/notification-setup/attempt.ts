export type NotificationSaveAttempt = {
  key: string;
  requestId: string;
};

/**
 * One request id per intended write. A retry of the same key reuses the id.
 * A different revision, value, or client gets a new id.
 */
export function notificationSaveAttempt(
  previous: NotificationSaveAttempt | null,
  key: string,
  newRequestId: () => string = () => crypto.randomUUID()
): NotificationSaveAttempt {
  if (previous && previous.key === key) return previous;
  return { key, requestId: newRequestId() };
}

export function preferenceSaveKey(clientAccountId: string, expectedRevision: number, enabled: boolean): string {
  return `preference:${clientAccountId}:${expectedRevision}:${enabled ? "1" : "0"}`;
}

export function recipientSaveKey(clientAccountId: string, expectedRevision: number, recipientEmail: string): string {
  return `recipient:${clientAccountId}:${expectedRevision}:${recipientEmail}`;
}
