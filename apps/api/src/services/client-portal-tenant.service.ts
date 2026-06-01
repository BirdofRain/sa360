import type { ClientPortalTenantConfig } from "../lib/client-portal-auth.js";
import {
  findClientAccountById,
  findClientAccountByPortalLoginEmail,
} from "../repositories/client-account.repository.js";

export type PortalClientContext = {
  clientAccountId: string;
  clientDisplayName: string;
  portalDisplayName: string | null;
  portalLoginEmail: string | null;
  portalEnabled: boolean;
  locationName: string | null;
  subaccountIdGhl: string | null;
  primaryNicheKeys: string[];
  primaryProductTypes: string[];
};

function parseStringList(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json.filter((v): v is string => typeof v === "string");
}

export async function getPortalClientContextByLoginEmail(
  loginEmail: string
): Promise<PortalClientContext | null> {
  const row = await findClientAccountByPortalLoginEmail(loginEmail);
  if (!row) return null;
  return {
    clientAccountId: row.clientAccountId,
    clientDisplayName: row.clientDisplayName,
    portalDisplayName: row.portalDisplayName,
    portalLoginEmail: row.portalLoginEmail,
    portalEnabled: row.portalEnabled,
    locationName: row.ghlDestination?.locationName ?? null,
    subaccountIdGhl: row.ghlDestination?.destinationSubaccountIdGhl ?? null,
    primaryNicheKeys: parseStringList(row.primaryNicheKeys),
    primaryProductTypes: parseStringList(row.primaryProductTypes),
  };
}

export type ResolvePortalTenantResult =
  | { tenant: ClientPortalTenantConfig; portalEnabled: boolean }
  | { error: string; code: "NOT_FOUND" | "PORTAL_DISABLED" };

/** Resolve dashboard tenant from query param or env fallback. */
export async function resolveClientPortalTenant(
  clientAccountIdParam?: string
): Promise<ResolvePortalTenantResult> {
  const envId = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID?.trim();
  const id = clientAccountIdParam?.trim() || envId;
  if (!id) {
    return {
      error: "clientAccountId is required when CLIENT_PORTAL_CLIENT_ACCOUNT_ID is unset",
      code: "NOT_FOUND",
    };
  }

  const account = await findClientAccountById(id);
  if (account) {
    if (!account.portalEnabled) {
      return { error: "Client portal is not enabled", code: "PORTAL_DISABLED" };
    }
    const sub = account.ghlDestination?.destinationSubaccountIdGhl?.trim();
    return {
      tenant: {
        clientAccountId: account.clientAccountId,
        ...(sub ? { subaccountIdGhl: sub } : {}),
      },
      portalEnabled: true,
    };
  }

  if (clientAccountIdParam?.trim()) {
    return { error: "Client account not found", code: "NOT_FOUND" };
  }

  if (envId) {
    const sub = process.env.CLIENT_PORTAL_SUBACCOUNT_ID_GHL?.trim();
    return {
      tenant: {
        clientAccountId: envId,
        ...(sub ? { subaccountIdGhl: sub } : {}),
      },
      portalEnabled: true,
    };
  }

  return { error: "Client portal tenant not configured", code: "NOT_FOUND" };
}
