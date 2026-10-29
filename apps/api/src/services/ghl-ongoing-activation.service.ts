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

export type OngoingActivationAssessment =
  | { ok: true; patch: OngoingActivationPatch; action: string }
  | { ok: false; code: "CONFIRMATION_REQUIRED" | "NO_DESTINATION" | "NOT_CONNECTED" | "WORKFLOW_REQUIRED" | "PIPELINE_REQUIRED"; error: string };

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
  | { ok: true; clientAccountId: string; patch: OngoingActivationPatch; auditAction: string }
  | { notFound: true }
  | { ok: false; code: OngoingActivationAssessment extends { ok: false; code: infer C } ? C : string; error: string };

type ActivationClient = {
  clientAccountId: string;
  ghlDestination: OngoingActivationDestination | null;
};

type ActivationDeps = {
  findClient: (clientAccountId: string) => Promise<ActivationClient | null>;
  updateDestination: (
    clientAccountId: string,
    patch: OngoingActivationPatch
  ) => Promise<void>;
  writeAudit: (input: {
    clientAccountId: string;
    requestId: string;
    action: string;
    actorLabel: string | null;
    metadata: Prisma.InputJsonObject;
  }) => Promise<void>;
};

const defaultDeps: ActivationDeps = {
  findClient: async (clientAccountId) => {
    const client = await findClientAccountById(clientAccountId);
    if (!client) return null;
    return {
      clientAccountId: client.clientAccountId,
      ghlDestination: activationDestination(client.ghlDestination),
    };
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
  } | null
): OngoingActivationDestination | null {
  if (!destination) return null;
  return {
    destinationSubaccountIdGhl: destination.destinationSubaccountIdGhl,
    ghlConnectionStatus: destination.ghlConnectionStatus,
    destinationWorkflowIdGhl: destination.destinationWorkflowIdGhl,
    workflowTriggerMode: destination.workflowTriggerMode,
    opportunityCreationEnabled: destination.opportunityCreationEnabled,
    destinationPipelineIdGhl: destination.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl: destination.destinationPipelineStageIdGhl,
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
  await deps.updateDestination(client.clientAccountId, assessment.patch);
  const locationId = client.ghlDestination?.destinationSubaccountIdGhl?.trim() ?? "";
  await deps.writeAudit({
    clientAccountId: client.clientAccountId,
    requestId: `ghl-ongoing:${randomUUID()}`,
    action: assessment.action,
    actorLabel: input.actorLabel?.trim() || null,
    metadata: {
      enabled: input.enabled,
      locationId,
      deliveryEnabled: assessment.patch.deliveryEnabled,
      deliveryMode: assessment.patch.deliveryMode,
      clientCutoverApproved: assessment.patch.clientCutoverApproved,
      internalApprovalStatus: assessment.patch.internalApprovalStatus,
      sendsLead: false,
    },
  });
  return {
    ok: true,
    clientAccountId: client.clientAccountId,
    patch: assessment.patch,
    auditAction: assessment.action,
  };
}
