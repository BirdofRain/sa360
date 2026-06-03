import type { GhlLocationConfigSnapshot } from "@prisma/client";
import type { GhlConfigDiscoveryResult } from "./ghl-config-discovery.types.js";

const TOKEN_DENY = /access_token|refresh_token|client_secret|authorization/i;

export function assertNoTokensInGhlConfigPayload(obj: Record<string, unknown>): void {
  const json = JSON.stringify(obj);
  if (TOKEN_DENY.test(json)) {
    throw new Error("GHL config response must not contain tokens or secrets.");
  }
}

export function snapshotToDiscoveryResult(
  row: GhlLocationConfigSnapshot,
  requiredFields: GhlConfigDiscoveryResult["requiredFields"]
): GhlConfigDiscoveryResult {
  const locationJson = row.locationJson as GhlConfigDiscoveryResult["location"] | null;
  return {
    location: locationJson ?? {
      id: row.locationId,
      name: row.locationName,
      companyId: null,
      timezone: null,
    },
    pipelines: (row.pipelinesJson as GhlConfigDiscoveryResult["pipelines"]) ?? [],
    workflows: (row.workflowsJson as GhlConfigDiscoveryResult["workflows"]) ?? [],
    users: (row.usersJson as GhlConfigDiscoveryResult["users"]) ?? [],
    customFields: (row.customFieldsJson as GhlConfigDiscoveryResult["customFields"]) ?? [],
    tags: (row.tagsJson as GhlConfigDiscoveryResult["tags"]) ?? [],
    fetchedAt: row.fetchedAt.toISOString(),
    fromCache: true,
    warnings: Array.isArray(row.warningsJson)
      ? row.warningsJson.filter((w): w is string => typeof w === "string")
      : [],
    errors: Array.isArray(row.errorsJson)
      ? row.errorsJson.filter((e): e is string => typeof e === "string")
      : [],
    requiredFields,
  };
}
