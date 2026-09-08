import {
  missingRequiredAccountFields,
  profilePayloadFromForm,
  type PortalAccountActionState,
  type PortalAccountProfile,
} from "./account-profile.ts";

export const PORTAL_ACCOUNT_PREVIEW_SCENARIOS = ["incomplete", "complete"] as const;

export type PortalAccountPreviewScenario =
  (typeof PORTAL_ACCOUNT_PREVIEW_SCENARIOS)[number];

export function portalAccountPreviewAccount(
  scenario: PortalAccountPreviewScenario
): PortalAccountProfile {
  if (scenario === "complete") {
    return {
      clientDisplayName: "Northwind",
      portalDisplayName: "Alex",
      portalLoginEmail: "alex@example.com",
      primaryNicheKeys: ["vet"],
      primaryProductTypes: ["aged"],
      status: "active",
      profileComplete: true,
      readyToOrder: true,
      missingFields: [],
    };
  }
  return {
    clientDisplayName: "Northwind",
    portalDisplayName: null,
    portalLoginEmail: "alex@example.com",
    primaryNicheKeys: [],
    primaryProductTypes: [],
    status: "onboarding",
    profileComplete: false,
    readyToOrder: false,
    missingFields: ["primaryNicheKeys", "primaryProductTypes"],
  };
}

export function parsePortalAccountPreviewScenario(
  raw: string | undefined
): PortalAccountPreviewScenario {
  if (raw && (PORTAL_ACCOUNT_PREVIEW_SCENARIOS as readonly string[]).includes(raw)) {
    return raw as PortalAccountPreviewScenario;
  }
  return "incomplete";
}

export async function previewSavePortalAccount(
  _prev: PortalAccountActionState | undefined,
  formData: FormData
): Promise<PortalAccountActionState> {
  const payload = profilePayloadFromForm(formData);
  return {
    ok: true,
    account: {
      clientDisplayName: payload.clientDisplayName?.trim() || "Northwind",
      portalDisplayName: payload.portalDisplayName ?? null,
      portalLoginEmail: "alex@example.com",
      primaryNicheKeys: payload.primaryNicheKeys ?? [],
      primaryProductTypes: payload.primaryProductTypes ?? [],
      status: "onboarding",
      profileComplete: false,
      readyToOrder: false,
      missingFields: missingRequiredAccountFields(payload),
    },
  };
}

export async function previewCompletePortalAccount(
  _prev: PortalAccountActionState | undefined,
  formData: FormData
): Promise<PortalAccountActionState> {
  const payload = profilePayloadFromForm(formData);
  const missing = missingRequiredAccountFields(payload);
  if (missing.length > 0) {
    return {
      ok: false,
      error: "Add the required account details before finishing setup.",
      missingFields: missing,
    };
  }
  return {
    ok: true,
    account: {
      clientDisplayName: payload.clientDisplayName?.trim() || "Northwind",
      portalDisplayName: payload.portalDisplayName ?? null,
      portalLoginEmail: "alex@example.com",
      primaryNicheKeys: payload.primaryNicheKeys ?? [],
      primaryProductTypes: payload.primaryProductTypes ?? [],
      status: "active",
      profileComplete: true,
      readyToOrder: true,
      missingFields: [],
    },
  };
}
