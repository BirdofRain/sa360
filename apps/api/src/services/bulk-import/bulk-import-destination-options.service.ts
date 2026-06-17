import { listClientAccounts } from "../../repositories/client-account.repository.js";
import { findGhlLocationConnectionByLocationId } from "../../repositories/ghl-location-connection.repository.js";
import {
  destinationInputFromGhlDestination,
  evaluateDestinationReadiness,
} from "../destination-readiness.service.js";

export type BulkImportDestinationOptionItem = {
  clientAccountId: string;
  clientDisplayName: string;
  locationIdGhl: string;
  locationName: string;
  oauthStatus: string;
  readinessStatus: string;
  readyForSimulation: boolean;
  readyForDirectCanary: boolean;
  blockers: string[];
};

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

    items.push({
      clientAccountId: client.clientAccountId,
      clientDisplayName: client.clientDisplayName,
      locationIdGhl,
      locationName: dest.locationName?.trim() || locationIdGhl,
      oauthStatus,
      readinessStatus: readiness.readinessStatus,
      readyForSimulation: readiness.readyForSimulation,
      readyForDirectCanary: readiness.readyForDirectCanary,
      blockers: readiness.blockers,
    });
  }

  items.sort((a, b) => {
    const byClient = a.clientDisplayName.localeCompare(b.clientDisplayName);
    if (byClient !== 0) return byClient;
    return a.locationName.localeCompare(b.locationName);
  });

  return items;
}
