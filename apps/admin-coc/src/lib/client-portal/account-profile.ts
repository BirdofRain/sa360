import type { PortalTrustView } from "./map-client-trust.ts";

export const CLIENT_PROFILE_REQUIRED_FIELDS = [
  "clientDisplayName",
  "primaryNicheKeys",
  "primaryProductTypes",
] as const;

export type ClientProfileRequiredField = (typeof CLIENT_PROFILE_REQUIRED_FIELDS)[number];

export type PortalAccountProfile = {
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

export type PortalAccountProfilePayload = {
  clientDisplayName?: string;
  portalDisplayName?: string | null;
  primaryNicheKeys?: string[];
  primaryProductTypes?: string[];
};

export type PortalAccountActionState = {
  ok: boolean;
  error?: string;
  account?: PortalAccountProfile;
  missingFields?: string[];
};

export type PortalAccountFormAction = (
  prev: PortalAccountActionState | undefined,
  formData: FormData
) => Promise<PortalAccountActionState> | PortalAccountActionState;

export type PortalAccountTrustRefreshState = {
  trust: PortalTrustView | null;
  error: string | null;
};

const REQUIRED_FIELD_COPY: Record<ClientProfileRequiredField, string> = {
  clientDisplayName: "Enter your account name.",
  primaryNicheKeys: "Add at least one lead focus.",
  primaryProductTypes: "Add at least one product type.",
};

export function parseCommaSeparatedList(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 32);
}

export function profilePayloadFromForm(formData: FormData): PortalAccountProfilePayload {
  const displayName = String(formData.get("clientDisplayName") ?? "").trim();
  const greeting = String(formData.get("portalDisplayName") ?? "").trim();
  return {
    clientDisplayName: displayName,
    portalDisplayName: greeting || null,
    primaryNicheKeys: parseCommaSeparatedList(String(formData.get("primaryNicheKeys") ?? "")),
    primaryProductTypes: parseCommaSeparatedList(String(formData.get("primaryProductTypes") ?? "")),
  };
}

export function formatCommaSeparatedList(values: string[] | undefined): string {
  return (values ?? []).join(", ");
}

export function clientProfileFieldError(
  field: ClientProfileRequiredField,
  missingFields: readonly string[] | undefined
): string | null {
  return missingFields?.includes(field) ? REQUIRED_FIELD_COPY[field] : null;
}

export function customerAccountErrorCopy(error: string | null | undefined, status?: number): string {
  const raw = error?.trim() ?? "";
  if (status === 409 || /not accepting onboarding|paused|archived/i.test(raw)) {
    return "This account is paused. Contact SA360 to continue setup.";
  }
  if (status === 400 || /required account details|PROFILE_INCOMPLETE/i.test(raw)) {
    return "Add the required account details before finishing setup.";
  }
  if (/invalid body|unrecognized_keys|strict/i.test(raw)) {
    return "That setting can only be changed by your SA360 team.";
  }
  if (!raw) return "We couldn’t save your account. Try again.";
  if (/not found|not enabled|not configured/i.test(raw)) {
    return "We couldn’t reach your account just now. Try again in a moment.";
  }
  return "We couldn’t save your account. Try again.";
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parsePortalAccountProfile(raw: unknown): PortalAccountProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const clientDisplayName = asString(row.clientDisplayName);
  if (!clientDisplayName) return null;
  const missingFields = asStringList(row.missingFields).filter((field): field is ClientProfileRequiredField =>
    (CLIENT_PROFILE_REQUIRED_FIELDS as readonly string[]).includes(field)
  );
  return {
    clientDisplayName,
    portalDisplayName: asString(row.portalDisplayName),
    portalLoginEmail: asString(row.portalLoginEmail),
    primaryNicheKeys: asStringList(row.primaryNicheKeys),
    primaryProductTypes: asStringList(row.primaryProductTypes),
    status: asString(row.status) ?? "onboarding",
    profileComplete: row.profileComplete === true,
    readyToOrder: row.readyToOrder === true,
    missingFields,
  };
}

export function isPortalAccountSetupComplete(profile: PortalAccountProfile | null): boolean {
  return Boolean(profile?.readyToOrder);
}

/** Keep a completed local profile if a later server snapshot is still incomplete. */
export function preferPortalAccountProfile(
  displayed: PortalAccountProfile,
  incoming: PortalAccountProfile
): PortalAccountProfile {
  if (isPortalAccountSetupComplete(displayed) && !isPortalAccountSetupComplete(incoming)) {
    return displayed;
  }
  return incoming;
}
