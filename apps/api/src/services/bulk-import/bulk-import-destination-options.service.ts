import {
  normalizeBulkImportDestinationOption,
  type BulkImportDestinationOptionNormalized,
} from "@sa360/shared";
import { isBulkImportInitialCanaryDestination } from "../../lib/bulk-import-demo-canary-config.js";
import { listClientAccounts } from "../../repositories/client-account.repository.js";
import { findGhlLocationConnectionByLocationId } from "../../repositories/ghl-location-connection.repository.js";
import { isDirectLiveDeliveryEnvConfigured } from "../../lib/direct-demo-delivery-config.js";
import {
  destinationInputFromGhlDestination,
  evaluateDestinationReadiness,
} from "../destination-readiness.service.js";

export type BulkImportDestinationOptionItem = BulkImportDestinationOptionNormalized;

function buildLiveCanaryMetadata(
  clientAccountId: string,
  locationIdGhl: string,
  readyForDirectCanary: boolean
): Pick<
  BulkImportDestinationOptionItem,
  "isInitialCanaryTarget" | "canRunLiveCanary" | "liveCanaryBlockers"
> {
  const isInitialCanaryTarget = isBulkImportInitialCanaryDestination(
    clientAccountId,
    locationIdGhl
  );
  const liveCanaryBlockers: string[] = [];
  if (!isInitialCanaryTarget) {
    liveCanaryBlockers.push(
      "This destination is not the configured initial live-canary client/location pair."
    );
  }
  if (!readyForDirectCanary) {
    liveCanaryBlockers.push("Destination is not ready for direct canary.");
  }
  if (!isDirectLiveDeliveryEnvConfigured()) {
    liveCanaryBlockers.push("Explicit live-delivery environment allowlist is missing.");
  }
  return {
    isInitialCanaryTarget,
    canRunLiveCanary:
      isInitialCanaryTarget && readyForDirectCanary && isDirectLiveDeliveryEnvConfigured(),
    liveCanaryBlockers,
  };
}

export async function listBulkImportDestinationOptions(): Promise<BulkImportDestinationOptionItem[]> {
  const clients = await listClientAccounts({});
  const items: BulkImportDestinationOptionItem[] = [];

  for (const client of clients) {
    const dest = client.ghlDestination;
    if (!dest?.destinationSubaccountIdGhl?.trim()) continue;

    const locationIdGhl = dest.destinationSubaccountIdGhl.trim();
    const connection = await findGhlLocationConnectionByLocationId(locationIdGhl);
    const readiness = evaluateDestinationReadiness(
      destinationInputFromGhlDestination(
        client,
        dest,
        connection
          ? {
              connectionStatus: connection.connectionStatus,
              lastProbeAt: connection.lastProbeAt,
              lastError: connection.lastError,
            }
          : null
      )
    );

    const oauthStatus =
      connection?.connectionStatus?.trim() ||
      dest.ghlConnectionStatus?.trim() ||
      "disconnected";

    items.push(
      normalizeBulkImportDestinationOption({
        clientAccountId: client.clientAccountId,
        clientDisplayName: client.clientDisplayName,
        locationIdGhl,
        locationName: dest.locationName?.trim() || locationIdGhl,
        oauthStatus,
        readinessStatus: readiness.readinessStatus,
        readyForSimulation: readiness.readyForSimulation,
        readyForDirectCanary: readiness.readyForDirectCanary,
        blockers: readiness.blockers,
        ...buildLiveCanaryMetadata(
          client.clientAccountId,
          locationIdGhl,
          readiness.readyForDirectCanary
        ),
      })
    );
  }

  items.sort((a, b) => {
    const byClient = a.clientDisplayName.localeCompare(b.clientDisplayName);
    if (byClient !== 0) return byClient;
    return a.locationName.localeCompare(b.locationName);
  });

  return items;
}
