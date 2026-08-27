import type { ClientAccountStatus } from "./types";

export function formatClientAccountStatusLabel(status: string): string {
  if (status === "onboarding") return "Onboarding";
  if (status === "active") return "Active / Ready to order";
  if (status === "paused") return "Paused";
  if (status === "archived") return "Archived";
  return status;
}

export function clientAccountStatusSelectOptions(): Array<{
  value: ClientAccountStatus;
  label: string;
}> {
  return [
    { value: "onboarding", label: "Onboarding" },
    { value: "active", label: "Active / Ready to order" },
    { value: "paused", label: "Paused" },
    { value: "archived", label: "Archived" },
  ];
}
