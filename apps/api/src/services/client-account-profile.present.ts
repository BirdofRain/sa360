import type { ClientAccount } from "@prisma/client";

export const CLIENT_PROFILE_REQUIRED_FIELDS = [
  "clientDisplayName",
  "primaryNicheKeys",
  "primaryProductTypes",
] as const;

export type ClientProfileRequiredField = (typeof CLIENT_PROFILE_REQUIRED_FIELDS)[number];

export type ClientAccountProfileDto = {
  clientDisplayName: string;
  portalDisplayName: string | null;
  portalLoginEmail: string | null;
  primaryNicheKeys: string[];
  primaryProductTypes: string[];
  status: string;
  profileComplete: boolean;
  readyToOrder: boolean;
  missingFields: ClientProfileRequiredField[];
};

export function parseClientProfileStringList(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function evaluateClientProfileCompleteness(input: {
  clientDisplayName: string | null | undefined;
  primaryNicheKeys: unknown;
  primaryProductTypes: unknown;
}): { complete: boolean; missingFields: ClientProfileRequiredField[] } {
  const missingFields: ClientProfileRequiredField[] = [];
  if (!input.clientDisplayName?.trim()) missingFields.push("clientDisplayName");
  if (parseClientProfileStringList(input.primaryNicheKeys).length === 0) {
    missingFields.push("primaryNicheKeys");
  }
  if (parseClientProfileStringList(input.primaryProductTypes).length === 0) {
    missingFields.push("primaryProductTypes");
  }
  return { complete: missingFields.length === 0, missingFields };
}

/** Authoritative customer-safe order eligibility from the account contract. */
export function isClientAccountReadyToOrder(status: string | null | undefined): boolean {
  return status === "active";
}

export function presentClientAccountProfile(row: ClientAccount): ClientAccountProfileDto {
  const primaryNicheKeys = parseClientProfileStringList(row.primaryNicheKeys);
  const primaryProductTypes = parseClientProfileStringList(row.primaryProductTypes);
  const { complete, missingFields } = evaluateClientProfileCompleteness({
    clientDisplayName: row.clientDisplayName,
    primaryNicheKeys,
    primaryProductTypes,
  });

  return {
    clientDisplayName: row.clientDisplayName,
    portalDisplayName: row.portalDisplayName,
    portalLoginEmail: row.portalLoginEmail,
    primaryNicheKeys,
    primaryProductTypes,
    status: row.status,
    profileComplete: complete,
    readyToOrder: isClientAccountReadyToOrder(row.status),
    missingFields,
  };
}
