export const CLIENT_ACCOUNT_STATUSES = [
  "active",
  "paused",
  "onboarding",
  "archived",
] as const;

export type ClientAccountStatus = (typeof CLIENT_ACCOUNT_STATUSES)[number];

export function isClientAccountStatus(value: string): value is ClientAccountStatus {
  return (CLIENT_ACCOUNT_STATUSES as readonly string[]).includes(value);
}
