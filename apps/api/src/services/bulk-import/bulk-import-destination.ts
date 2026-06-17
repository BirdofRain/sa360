import { GHL_CONNECTION_CONNECTED } from "../../lib/delivery-readiness-status.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { findGhlLocationConnectionByLocationId } from "../../repositories/ghl-location-connection.repository.js";
import {
  destinationInputFromGhlDestination,
  evaluateDestinationReadiness,
} from "../destination-readiness.service.js";
import type { BulkImportOptions } from "./bulk-import.types.js";

export type FlatBulkImportDestinationBody = {
  destinationClientAccountId: string;
  destinationLocationIdGhl: string;
  vendorLabel?: string;
  campaignLabel?: string;
  nicheKey?: string;
  nicheLabel?: string;
  productType?: string;
  ownerOverrideIdGhl?: string;
  workflowStrategy?: BulkImportOptions["workflowStrategy"];
  workflowWarningAcknowledged?: boolean;
  useExistingRoutingRules?: boolean;
  operator?: string;
};

export function flatDestinationBodyToOptions(
  body: FlatBulkImportDestinationBody
): BulkImportOptions {
  return {
    vendorLabel: body.vendorLabel,
    campaignLabel: body.campaignLabel,
    nicheKey: body.nicheKey,
    nicheLabel: body.nicheLabel,
    productType: body.productType,
    ownerOverrideIdGhl: body.ownerOverrideIdGhl,
    workflowStrategy: body.workflowStrategy ?? "source_tag_only",
    workflowWarningAcknowledged: body.workflowWarningAcknowledged ?? true,
    useExistingRoutingRules: body.useExistingRoutingRules ?? false,
  };
}

export async function validateBulkImportDestinationSelection(input: {
  destinationClientAccountId: string;
  destinationLocationIdGhl: string;
}) {
  const client = await findClientAccountById(input.destinationClientAccountId.trim());
  if (!client?.ghlDestination) {
    throw new Error("destination_not_found");
  }

  const linkedLocationId = client.ghlDestination.destinationSubaccountIdGhl.trim();
  if (input.destinationLocationIdGhl.trim() !== linkedLocationId) {
    throw new Error("location_not_linked_to_client");
  }

  const connection = await findGhlLocationConnectionByLocationId(linkedLocationId);
  const readiness = evaluateDestinationReadiness(
    destinationInputFromGhlDestination(
      client,
      client.ghlDestination,
      connection
        ? {
            connectionStatus: connection.connectionStatus,
            lastProbeAt: connection.lastProbeAt,
            lastError: connection.lastError,
          }
        : null
    )
  );

  const oauthConnected =
    connection?.connectionStatus?.toLowerCase() === GHL_CONNECTION_CONNECTED ||
    client.ghlDestination.ghlConnectionStatus?.toLowerCase() === GHL_CONNECTION_CONNECTED;

  if (!oauthConnected) {
    throw new Error("oauth_not_connected");
  }

  if (!readiness.readyForSimulation) {
    throw new Error("destination_not_ready_for_simulation");
  }

  return { client, readiness, connection };
}
