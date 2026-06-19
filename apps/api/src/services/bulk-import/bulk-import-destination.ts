import { findGhlLocationConnectionByLocationId } from "../../repositories/ghl-location-connection.repository.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { GHL_CONNECTION_CONNECTED } from "../../lib/delivery-readiness-status.js";
import {
  destinationInputFromGhlDestination,
  evaluateDestinationReadiness,
} from "../destination-readiness.service.js";
import type { BulkImportOptions } from "./bulk-import.types.js";
import { BulkImportDestinationError } from "./bulk-import-destination-errors.js";

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
  const requestedClientId = input.destinationClientAccountId.trim();
  const requestedLocationId = input.destinationLocationIdGhl.trim();

  const client = await findClientAccountById(requestedClientId);
  if (!client) {
    throw new BulkImportDestinationError(
      "destination_not_found",
      "The selected client account was not found."
    );
  }
  if (!client.ghlDestination) {
    throw new BulkImportDestinationError(
      "destination_not_found",
      "The selected client does not have a GHL destination configured."
    );
  }

  const connection = await findGhlLocationConnectionByLocationId(requestedLocationId);
  if (!connection) {
    throw new BulkImportDestinationError(
      "ghl_connection_not_found",
      "No GHL OAuth connection exists for the selected location."
    );
  }

  if (connection.clientAccountId && connection.clientAccountId !== requestedClientId) {
    throw new BulkImportDestinationError(
      "destination_identity_mismatch",
      `The selected GHL location is linked to ${connection.clientAccountId}, not ${requestedClientId}.`,
      connection.clientAccountId
    );
  }

  const linkedLocationId = client.ghlDestination.destinationSubaccountIdGhl.trim();
  if (requestedLocationId !== linkedLocationId) {
    throw new BulkImportDestinationError(
      "location_not_linked_to_client",
      `Location ${requestedLocationId} is not configured as the destination for ${requestedClientId}.`
    );
  }

  const readiness = evaluateDestinationReadiness(
    destinationInputFromGhlDestination(
      client,
      client.ghlDestination,
      {
        connectionStatus: connection.connectionStatus,
        lastProbeAt: connection.lastProbeAt,
        lastError: connection.lastError,
      }
    )
  );

  const oauthConnected =
    connection.connectionStatus?.toLowerCase() === GHL_CONNECTION_CONNECTED ||
    client.ghlDestination.ghlConnectionStatus?.toLowerCase() === GHL_CONNECTION_CONNECTED;

  if (!oauthConnected) {
    throw new BulkImportDestinationError(
      "oauth_not_connected",
      "The GHL location is not connected. Reconnect OAuth before continuing."
    );
  }

  if (!readiness.readyForSimulation) {
    throw new BulkImportDestinationError(
      "destination_not_ready_for_simulation",
      "The selected destination is not ready for simulation. Complete GHL configuration first."
    );
  }

  return { client, readiness, connection };
}
