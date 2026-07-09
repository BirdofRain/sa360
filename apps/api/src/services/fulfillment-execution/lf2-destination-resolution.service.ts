import type { ClientGhlDestination } from "@prisma/client";

function trim(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type AuthoritativeDestinationResolution =
  | {
      ok: true;
      authoritativeLocationId: string;
      metadataLocationId: string | null;
      destinationMismatch: false;
    }
  | {
      ok: false;
      code: "delivery_target_destination_mismatch";
      authoritativeLocationId: string;
      metadataLocationId: string;
      destinationMismatch: true;
    }
  | {
      ok: false;
      code: "destination_not_configured";
      destinationMismatch: false;
    };

export function resolveAuthoritativeGhlDestination(input: {
  clientDestination: ClientGhlDestination;
  targetConfigMetadataJson: unknown;
}): AuthoritativeDestinationResolution {
  const authoritativeLocationId = trim(input.clientDestination.destinationSubaccountIdGhl);
  if (!authoritativeLocationId) {
    return { ok: false, code: "destination_not_configured", destinationMismatch: false };
  }

  const metadata =
    input.targetConfigMetadataJson &&
    typeof input.targetConfigMetadataJson === "object" &&
    !Array.isArray(input.targetConfigMetadataJson)
      ? (input.targetConfigMetadataJson as Record<string, unknown>)
      : {};
  const metadataLocationId = trim(metadata.destinationSubaccountIdGhl);

  if (metadataLocationId && metadataLocationId !== authoritativeLocationId) {
    return {
      ok: false,
      code: "delivery_target_destination_mismatch",
      authoritativeLocationId,
      metadataLocationId,
      destinationMismatch: true,
    };
  }

  return {
    ok: true,
    authoritativeLocationId,
    metadataLocationId,
    destinationMismatch: false,
  };
}
