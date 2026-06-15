import type { ClientGhlDestination } from "@prisma/client";
import type { RoutingRuleGhlConfigBody } from "../../schemas/ghl-config.schema.js";
import {
  findClientAccountById,
  upsertClientGhlDestination,
} from "../../repositories/client-account.repository.js";
import {
  findGhlLocationConnectionByLocationId,
  listGhlLocationConnections,
} from "../../repositories/ghl-location-connection.repository.js";
import { findLatestGhlLocationConfigSnapshot } from "../../repositories/ghl-location-config-snapshot.repository.js";
import { presentClientGhlDestination } from "../client-onboarding.present.js";
import type { ClientGhlDestinationDto } from "../client-onboarding.present.js";
import {
  destinationInputFromGhlDestination,
  evaluateDestinationReadiness,
  type DestinationReadinessAssessment,
} from "../destination-readiness.service.js";
import { presentGhlLocationConnection } from "../ghl-oauth/ghl-connection.present.js";
import type { GhlLocationConnectionItem } from "../ghl-oauth/ghl-connection.present.js";
import {
  buildDestinationUpsertData,
  checkClientGhlLocationMismatch,
  ghlStatusFromConnection,
  trimOrNull,
} from "./client-ghl-destination-upsert.js";
import {
  buildMergedSa360FieldMapForGhlConfigSave,
  buildMergedSa360OptionMapForGhlConfigSave,
} from "./routing-rule-ghl-config.service.js";
import { buildFieldMappingSaveReport } from "../sa360-custom-field-mapping.service.js";
import type { GhlDiscoveredCustomField } from "./ghl-config-discovery.types.js";
import { snapshotToDiscoveryResult } from "./ghl-config-discovery.present.js";
import { detectSa360RequiredCustomFields } from "./ghl-config-discovery.service.js";

export type ClientDeliveryConfigSummary = {
  clientAccountId: string;
  clientDisplayName: string;
  locationId: string | null;
  locationName: string | null;
  connection: GhlLocationConnectionItem | null;
  ghlDestination: ClientGhlDestinationDto | null;
  destinationReadiness: DestinationReadinessAssessment | null;
  locationMismatch: boolean;
  issueCodes: string[];
  discoverySummary: Record<string, unknown> | null;
};

export type SaveClientGhlConfigResult =
  | {
      ghlDestination: ClientGhlDestinationDto;
      destinationReadiness: DestinationReadinessAssessment;
      fieldMapping: ReturnType<typeof buildFieldMappingSaveReport>;
    }
  | { notFound: true }
  | { error: string; code: "LOCATION_MISMATCH" | "NOT_CONNECTED" | "VALIDATION" };

function resolveLocationId(
  queryLocationId: string | undefined,
  clientConnections: Awaited<ReturnType<typeof listGhlLocationConnections>>,
  dest: ClientGhlDestination | null | undefined
): string | null {
  const fromQuery = trimOrNull(queryLocationId);
  if (fromQuery) return fromQuery;
  const linked = clientConnections.find((c) => c.clientAccountId)?.locationId;
  if (linked) return linked;
  return trimOrNull(dest?.destinationSubaccountIdGhl);
}

export async function getClientDeliveryConfigSummary(
  clientAccountId: string,
  queryLocationId?: string
): Promise<ClientDeliveryConfigSummary | { notFound: true }> {
  const client = await findClientAccountById(clientAccountId.trim());
  if (!client) return { notFound: true };

  const connections = await listGhlLocationConnections({
    clientAccountId: client.clientAccountId,
    limit: 20,
  });
  const dest = client.ghlDestination;
  const locationId = resolveLocationId(queryLocationId, connections, dest);

  let connection: GhlLocationConnectionItem | null = null;
  if (locationId) {
    const row = await findGhlLocationConnectionByLocationId(locationId);
    if (row) {
      connection = presentGhlLocationConnection(row);
    }
  } else if (connections[0]) {
    connection = presentGhlLocationConnection(connections[0]);
  }

  const locationMismatch =
    Boolean(locationId && dest?.destinationSubaccountIdGhl) &&
    dest!.destinationSubaccountIdGhl !== locationId;

  const issueCodes: string[] = [];
  if (!locationId) issueCodes.push("location_unlinked");
  if (connection?.connectionStatus === "revoked") issueCodes.push("oauth_revoked");
  if (connection && !connection.lastProbeAt && connection.connectionStatus === "connected") {
    issueCodes.push("probe_required");
  }
  if (locationMismatch) issueCodes.push("location_mismatch");

  let discoverySummary: Record<string, unknown> | null = null;
  if (locationId) {
    const snap = await findLatestGhlLocationConfigSnapshot(locationId);
    if (snap) {
      const fields = detectSa360RequiredCustomFields(
        (snap.customFieldsJson as GhlDiscoveredCustomField[]) ?? []
      );
      const d = snapshotToDiscoveryResult(snap, fields);
      discoverySummary = {
        fetchedAt: d.fetchedAt,
        pipelineCount: d.pipelines.length,
        workflowCount: d.workflows.length,
        requiredFieldsInstalled: d.requiredFields.requiredFieldsInstalled,
        missingRequiredFields: d.requiredFields.missingRequiredFields,
        sa360FieldMapping: d.sa360FieldMapping,
      };
    }
  }

  const destinationReadiness = dest
    ? evaluateDestinationReadiness(
        destinationInputFromGhlDestination(
          client,
          dest,
          connection
            ? {
                connectionStatus: connection.connectionStatus,
                lastProbeAt: connection.lastProbeAt ? new Date(connection.lastProbeAt) : null,
                lastError: connection.lastError,
              }
            : null
        )
      )
    : locationId
      ? evaluateDestinationReadiness({
          clientAccountId: client.clientAccountId,
          clientDisplayName: client.clientDisplayName,
          destinationSubaccountIdGhl: locationId,
          connectionStatus: connection?.connectionStatus ?? null,
          lastProbeAt: connection?.lastProbeAt ?? null,
          lastError: connection?.lastError ?? null,
        })
      : null;

  return {
    clientAccountId: client.clientAccountId,
    clientDisplayName: client.clientDisplayName,
    locationId,
    locationName: dest?.locationName ?? connection?.locationName ?? null,
    connection,
    ghlDestination: dest ? presentClientGhlDestination(dest) : null,
    destinationReadiness,
    locationMismatch,
    issueCodes: [...new Set([...issueCodes, ...(destinationReadiness?.issueCodes ?? [])])],
    discoverySummary,
  };
}

export async function saveClientGhlConfig(
  clientAccountId: string,
  body: RoutingRuleGhlConfigBody
): Promise<SaveClientGhlConfigResult> {
  const client = await findClientAccountById(clientAccountId.trim());
  if (!client) return { notFound: true };

  const locationId = body.locationId.trim();
  const existingDest = client.ghlDestination ?? null;
  const connection = await findGhlLocationConnectionByLocationId(locationId);

  if (!connection || connection.connectionStatus === "revoked") {
    return {
      error: "No connected GHL OAuth location for this locationId.",
      code: "NOT_CONNECTED",
    };
  }

  if (
    connection.clientAccountId &&
    connection.clientAccountId !== client.clientAccountId &&
    body.confirmLocationMismatch !== true
  ) {
    return {
      error: `This GHL location is linked to client ${connection.clientAccountId}, not ${client.clientAccountId}.`,
      code: "LOCATION_MISMATCH",
    };
  }

  const mismatch = checkClientGhlLocationMismatch(
    existingDest?.destinationSubaccountIdGhl,
    locationId,
    connection.clientAccountId ? locationId : null,
    body.confirmLocationMismatch
  );
  if (mismatch) return mismatch;

  const ghlStatus = ghlStatusFromConnection(connection.connectionStatus);
  const snap = await findLatestGhlLocationConfigSnapshot(locationId);
  const snapFields = (snap?.customFieldsJson as GhlDiscoveredCustomField[]) ?? [];
  const mergedFieldMap = buildMergedSa360FieldMapForGhlConfigSave({
    snapFields,
    discoveryCustomFields: body.discoveryCustomFields as GhlDiscoveredCustomField[] | undefined,
    existingDest,
    bodyMapJson: body.sa360CustomFieldIdMapJson,
  });
  const mergedOptionMap = buildMergedSa360OptionMapForGhlConfigSave({
    existingDest,
    bodyOptionMapJson: body.sa360CustomFieldOptionMapJson,
    locationId,
  });
  const fieldMappingReport = buildFieldMappingSaveReport(
    mergedFieldMap,
    body.customFieldStampRequired ?? existingDest?.customFieldStampRequired ?? false
  );

  const upserted = await upsertClientGhlDestination(
    client.clientAccountId,
    buildDestinationUpsertData(
      locationId,
      existingDest,
      body,
      mergedFieldMap,
      mergedOptionMap,
      ghlStatus,
      snap?.locationName ?? connection.locationName
    )
  );

  const connItem = presentGhlLocationConnection(connection);
  const destinationReadiness = evaluateDestinationReadiness(
    destinationInputFromGhlDestination(client, upserted, {
      connectionStatus: connItem.connectionStatus,
      lastProbeAt: connItem.lastProbeAt ? new Date(connItem.lastProbeAt) : null,
      lastError: connItem.lastError,
    })
  );

  return {
    ghlDestination: presentClientGhlDestination(upserted),
    destinationReadiness,
    fieldMapping: fieldMappingReport,
  };
}
