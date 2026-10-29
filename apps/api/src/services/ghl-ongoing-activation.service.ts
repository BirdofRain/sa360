/**
 * Operator authorization for ongoing GHL delivery.
 *
 * An authenticated admin connects a destination, then this action records the
 * four delivery flags and an audit row. It does not read SA360_DIRECT_DELIVERY_*
 * or SA360_LIVE_CANARY_ALLOWED_DESTINATIONS, does not send a lead, and does not
 * change Sheets dispatch or the Sheets cutoff.
 */

import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { findClientAccountById } from "../repositories/client-account.repository.js";
import { discoveredResourcesMatchDestination } from "./ongoing-ghl-activation-rules.js";

export type OngoingActivationPatch = {
  deliveryEnabled: boolean;
  deliveryMode: "live" | "shadow";
  clientCutoverApproved: boolean;
  internalApprovalStatus: "approved" | "not_reviewed";
};

export type OngoingActivationDestination = {
  destinationSubaccountIdGhl: string;
  ghlConnectionStatus: string | null;
  destinationWorkflowIdGhl: string | null;
  workflowTriggerMode: string | null;
  opportunityCreationEnabled: boolean;
  destinationPipelineIdGhl: string | null;
  destinationPipelineStageIdGhl: string | null;
};

export type OngoingActivationWrite = OngoingActivationPatch & {
  ongoingDeliveryNotBefore?: Date;
  activationLocationIdGhl: string | null;
  activationWorkflowIdGhl: string | null;
  activationPipelineIdGhl: string | null;
  activationStageIdGhl: string | null;
};

export type OngoingActivationAssessment =
  | { ok: true; patch: OngoingActivationPatch; action: string }
  | {
      ok: false;
      code: "CONFIRMATION_REQUIRED" | "NO_DESTINATION" | "NOT_CONNECTED" | "WORKFLOW_REQUIRED" | "PIPELINE_REQUIRED";
      error: string;
    };

export function assessOngoingGhlActivation(input: {
  enabled: boolean;
  confirmLiveDeliveryRisk: boolean;
  destination: OngoingActivationDestination | null;
}): OngoingActivationAssessment {
  if (input.confirmLiveDeliveryRisk !== true) {
    return {
      ok: false,
      code: "CONFIRMATION_REQUIRED",
      error: "confirmLiveDeliveryRisk must be true. This action does not send a lead.",
    };
  }
  if (!input.destination?.destinationSubaccountIdGhl?.trim()) {
    return {
      ok: false,
      code: "NO_DESTINATION",
      error: "Connect a GHL location before changing ongoing delivery.",
    };
  }
  if (!input.enabled) {
    return {
      ok: true,
      action: "ghl_ongoing_delivery_disabled",
      patch: {
        deliveryEnabled: false,
        deliveryMode: "shadow",
        clientCutoverApproved: false,
        internalApprovalStatus: "not_reviewed",
      },
    };
  }
  if (input.destination.ghlConnectionStatus !== "connected") {
    return {
      ok: false,
      code: "NOT_CONNECTED",
      error: "The GHL location must be connected before ongoing delivery is enabled.",
    };
  }
  const mode = input.destination.workflowTriggerMode?.trim() || "tag_trigger";
  if (mode !== "none" && !input.destination.destinationWorkflowIdGhl?.trim()) {
    return {
      ok: false,
      code: "WORKFLOW_REQUIRED",
      error: "Select a workflow before enabling ongoing delivery.",
    };
  }
  if (
    input.destination.opportunityCreationEnabled &&
    (!input.destination.destinationPipelineIdGhl?.trim() ||
      !input.destination.destinationPipelineStageIdGhl?.trim())
  ) {
    return {
      ok: false,
      code: "PIPELINE_REQUIRED",
      error: "Select a pipeline and stage before enabling ongoing delivery.",
    };
  }
  return {
    ok: true,
    action: "ghl_ongoing_delivery_enabled",
    patch: {
      deliveryEnabled: true,
      deliveryMode: "live",
      clientCutoverApproved: true,
      internalApprovalStatus: "approved",
    },
  };
}

export type SetOngoingGhlDeliveryResult =
  | { ok: true; clientAccountId: string; patch: OngoingActivationWrite; auditAction: string }
  | { notFound: true }
  | {
      ok: false;
      code:
        | "CONFIRMATION_REQUIRED"
        | "NO_DESTINATION"
        | "NOT_CONNECTED"
        | "WORKFLOW_REQUIRED"
        | "PIPELINE_REQUIRED"
        | "DISCOVERY_REQUIRED"
        | "WORKFLOW_NOT_IN_LOCATION"
        | "PIPELINE_NOT_IN_LOCATION"
        | "STAGE_NOT_ON_PIPELINE";
      error: string;
    };

type ActivationClient = {
  clientAccountId: string;
  ghlDestination: (OngoingActivationDestination & { ongoingDeliveryNotBefore: Date | null }) | null;
};

type ActivationDeps = {
  now: () => Date;
  findClient: (clientAccountId: string) => Promise<ActivationClient | null>;
  findSnapshot: (
    locationId: string
  ) => Promise<{ workflowsJson: unknown; pipelinesJson: unknown } | null>;
  updateDestination: (clientAccountId: string, patch: OngoingActivationWrite) => Promise<void>;
  writeAudit: (input: {
    clientAccountId: string;
    requestId: string;
    action: string;
    actorLabel: string | null;
    metadata: Prisma.InputJsonObject;
  }) => Promise<void>;
};

const defaultDeps: ActivationDeps = {
  now: () => new Date(),
  findClient: async (clientAccountId) => {
    const client = await findClientAccountById(clientAccountId);
    if (!client) return null;
    return {
      clientAccountId: client.clientAccountId,
      ghlDestination: activationDestination(client.ghlDestination),
    };
  },
  findSnapshot: async (locationId) => {
    const snapshot = await prisma.ghlLocationConfigSnapshot.findFirst({
      where: { locationId },
      orderBy: { fetchedAt: "desc" },
    });
    if (!snapshot) return null;
    return { workflowsJson: snapshot.workflowsJson, pipelinesJson: snapshot.pipelinesJson };
  },
  updateDestination: async (clientAccountId, patch) => {
    await prisma.clientGhlDestination.update({
      where: { clientAccountId },
      data: patch,
    });
  },
  writeAudit: async (input) => {
    await prisma.clientOnboardingV2AuditEvent.create({
      data: {
        clientAccountId: input.clientAccountId,
        historicalClientAccountId: input.clientAccountId,
        requestId: input.requestId,
        action: input.action,
        actorLabel: input.actorLabel,
        auth: "admin_api_key",
        destinations: [],
        metadataJson: input.metadata,
      },
    });
  },
};

function activationDestination(
  destination: {
    destinationSubaccountIdGhl: string;
    ghlConnectionStatus: string | null;
    destinationWorkflowIdGhl: string | null;
    workflowTriggerMode: string | null;
    opportunityCreationEnabled: boolean;
    destinationPipelineIdGhl: string | null;
    destinationPipelineStageIdGhl: string | null;
    ongoingDeliveryNotBefore: Date | null;
  } | null
): (OngoingActivationDestination & { ongoingDeliveryNotBefore: Date | null }) | null {
  if (!destination) return null;
  return {
    destinationSubaccountIdGhl: destination.destinationSubaccountIdGhl,
    ghlConnectionStatus: destination.ghlConnectionStatus,
    destinationWorkflowIdGhl: destination.destinationWorkflowIdGhl,
    workflowTriggerMode: destination.workflowTriggerMode,
    opportunityCreationEnabled: destination.opportunityCreationEnabled,
    destinationPipelineIdGhl: destination.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl: destination.destinationPipelineStageIdGhl,
    ongoingDeliveryNotBefore: destination.ongoingDeliveryNotBefore,
  };
}

export async function setOngoingGhlDeliveryActivation(
  input: {
    clientAccountId: string;
    enabled: boolean;
    confirmLiveDeliveryRisk: boolean;
    actorLabel?: string | null;
  },
  deps: ActivationDeps = defaultDeps
): Promise<SetOngoingGhlDeliveryResult> {
  const clientAccountId = input.clientAccountId.trim();
  const client = await deps.findClient(clientAccountId);
  if (!client) return { notFound: true };
  const assessment = assessOngoingGhlActivation({
    enabled: input.enabled,
    confirmLiveDeliveryRisk: input.confirmLiveDeliveryRisk,
    destination: client.ghlDestination,
  });
  if (!assessment.ok) return assessment;
  const destination = client.ghlDestination;
  const locationId = destination?.destinationSubaccountIdGhl?.trim() ?? "";
  let write: OngoingActivationWrite;
  if (!input.enabled) {
    write = {
      ...assessment.patch,
      activationLocationIdGhl: null,
      activationWorkflowIdGhl: null,
      activationPipelineIdGhl: null,
      activationStageIdGhl: null,
    };
  } else {
    if (!destination) {
      return { ok: false, code: "NO_DESTINATION", error: "Connect a GHL location before changing ongoing delivery." };
    }
    const snapshot = await deps.findSnapshot(locationId);
    if (!snapshot) {
      return {
        ok: false,
        code: "DISCOVERY_REQUIRED",
        error: "Discover this location before enabling ongoing delivery.",
      };
    }
    const resources = discoveredResourcesMatchDestination({
      workflowTriggerMode: destination.workflowTriggerMode,
      destinationWorkflowIdGhl: destination.destinationWorkflowIdGhl,
      opportunityCreationEnabled: destination.opportunityCreationEnabled,
      destinationPipelineIdGhl: destination.destinationPipelineIdGhl,
      destinationPipelineStageIdGhl: destination.destinationPipelineStageIdGhl,
      workflowsJson: snapshot.workflowsJson,
      pipelinesJson: snapshot.pipelinesJson,
    });
    if (!resources.ok) return resources;
    write = {
      ...assessment.patch,
      ...(destination.ongoingDeliveryNotBefore ? {} : { ongoingDeliveryNotBefore: deps.now() }),
      activationLocationIdGhl: locationId,
      activationWorkflowIdGhl: destination.destinationWorkflowIdGhl,
      activationPipelineIdGhl: destination.destinationPipelineIdGhl,
      activationStageIdGhl: destination.destinationPipelineStageIdGhl,
    };
  }
  await deps.updateDestination(client.clientAccountId, write);
  await deps.writeAudit({
    clientAccountId: client.clientAccountId,
    requestId: `ghl-ongoing:${randomUUID()}`,
    action: assessment.action,
    actorLabel: input.actorLabel?.trim() || null,
    metadata: {
      enabled: input.enabled,
      locationId,
      workflowId: destination?.destinationWorkflowIdGhl ?? null,
      pipelineId: destination?.destinationPipelineIdGhl ?? null,
      stageId: destination?.destinationPipelineStageIdGhl ?? null,
      deliveryEnabled: write.deliveryEnabled,
      deliveryMode: write.deliveryMode,
      clientCutoverApproved: write.clientCutoverApproved,
      internalApprovalStatus: write.internalApprovalStatus,
      ongoingDeliveryNotBefore: write.ongoingDeliveryNotBefore?.toISOString() ?? null,
      sendsLead: false,
    },
  });
  return {
    ok: true,
    clientAccountId: client.clientAccountId,
    patch: write,
    auditAction: assessment.action,
  };
}
