/**
 * Operator activation of one saved GHL location.
 * This sets the persisted delivery flags. It does not edit an environment
 * allowlist, move another client's location, or send a lead.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { findClientAccountById } from "../repositories/client-account.repository.js";
import { findGhlLocationConnectionByLocationId } from "../repositories/ghl-location-connection.repository.js";
import {
  destinationInputFromGhlDestination,
  evaluateDestinationReadiness,
} from "./destination-readiness.service.js";
import { ENABLE_ONGOING_GHL_DELIVERY, isPersistedLiveDestination } from "./ghl-destination-authorization.js";

export type OngoingGhlActivationResult =
  | {
      ok: true;
      alreadyActive: boolean;
      locationId: string;
      deliveryEnabled: true;
      omittedCoreFields: string[];
      omittedOptionalFields: string[];
      opportunityCreationEnabled: boolean;
    }
  | { ok: false; statusCode: number; error: string };

export async function activateOngoingGhlDelivery(
  input: {
    clientAccountId: string;
    requestId: string;
    confirmation: string;
    actorLabel?: string | null;
  },
  db: PrismaClient = prisma
): Promise<OngoingGhlActivationResult> {
  const clientAccountId = input.clientAccountId.trim();
  const requestId = input.requestId.trim();
  if (!clientAccountId || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) {
    return { ok: false, statusCode: 400, error: "invalid_request" };
  }
  if (input.confirmation.trim() !== ENABLE_ONGOING_GHL_DELIVERY) {
    return { ok: false, statusCode: 400, error: "invalid_confirmation" };
  }
  const actorLabel = input.actorLabel?.trim() || null;
  if (actorLabel && actorLabel.length > 200) return { ok: false, statusCode: 400, error: "invalid_request" };

  const prior = await db.clientOnboardingV2AuditEvent.findUnique({ where: { requestId } });
  if (prior) {
    if (prior.clientAccountId !== clientAccountId || prior.action !== "activate_ghl_ongoing") {
      return { ok: false, statusCode: 409, error: "revision_conflict" };
    }
    return replay(prior.metadataJson);
  }

  const client = await findClientAccountById(clientAccountId, db);
  const destination = client?.ghlDestination;
  if (!client) return { ok: false, statusCode: 404, error: "client_not_found" };
  if (!destination?.destinationSubaccountIdGhl.trim()) {
    return { ok: false, statusCode: 409, error: "destination_not_configured" };
  }
  const locationId = destination.destinationSubaccountIdGhl.trim();
  const connection = await findGhlLocationConnectionByLocationId(locationId, db);
  if (!connection || connection.connectionStatus !== "connected") {
    return { ok: false, statusCode: 409, error: "oauth_not_connected" };
  }
  if (connection.clientAccountId !== clientAccountId) {
    return { ok: false, statusCode: 409, error: "location_not_linked" };
  }
  const other = await db.clientGhlDestination.findFirst({
    where: {
      destinationSubaccountIdGhl: locationId,
      clientAccountId: { not: clientAccountId },
      deliveryEnabled: true,
    },
    select: { clientAccountId: true },
  });
  if (other) return { ok: false, statusCode: 409, error: "location_owned_by_other_client" };
  if (!destination.destinationWorkflowIdGhl?.trim() || destination.workflowTriggerMode === "none") {
    return { ok: false, statusCode: 409, error: "workflow_required" };
  }
  if (
    destination.opportunityCreationEnabled &&
    (!destination.destinationPipelineIdGhl?.trim() || !destination.destinationPipelineStageIdGhl?.trim())
  ) {
    return { ok: false, statusCode: 409, error: "opportunity_not_configured" };
  }

  const readiness = evaluateDestinationReadiness(
    destinationInputFromGhlDestination(
      { clientAccountId, clientDisplayName: client.clientDisplayName },
      destination,
      {
        connectionStatus: connection.connectionStatus,
        lastProbeAt: connection.lastProbeAt,
        lastError: null,
      }
    )
  );
  const omittedCoreFields = readiness.fieldMapping.coreRequiredMissing;
  const omittedOptionalFields = readiness.fieldMapping.optionalMissing;
  const alreadyActive = isPersistedLiveDestination(destination, locationId);

  const metadata: Prisma.InputJsonObject = {
    locationId,
    alreadyActive,
    omittedCoreFields,
    omittedOptionalFields,
    opportunityCreationEnabled: destination.opportunityCreationEnabled,
  };

  await db.$transaction(async (tx) => {
    await tx.clientGhlDestination.update({
      where: { clientAccountId },
      data: {
        deliveryEnabled: true,
        deliveryMode: "live",
        clientCutoverApproved: true,
        internalApprovalStatus: "approved",
        ghlConnectionStatus: "connected",
      },
    });
    await tx.clientOnboardingV2AuditEvent.create({
      data: {
        clientAccountId,
        historicalClientAccountId: clientAccountId,
        requestId,
        action: "activate_ghl_ongoing",
        actorLabel,
        auth: "admin_api_key",
        destinations: [],
        metadataJson: metadata,
      },
    });
  });

  return {
    ok: true,
    alreadyActive,
    locationId,
    deliveryEnabled: true,
    omittedCoreFields,
    omittedOptionalFields,
    opportunityCreationEnabled: destination.opportunityCreationEnabled,
  };
}

function replay(metadata: Prisma.JsonValue): OngoingGhlActivationResult {
  const record = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
  const locationId = typeof record.locationId === "string" ? record.locationId : "";
  return {
    ok: true,
    alreadyActive: record.alreadyActive === true,
    locationId,
    deliveryEnabled: true,
    omittedCoreFields: stringList(record.omittedCoreFields),
    omittedOptionalFields: stringList(record.omittedOptionalFields),
    opportunityCreationEnabled: record.opportunityCreationEnabled === true,
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
