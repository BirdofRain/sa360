import { getGhlDeliveryAdapterMode } from "../../lib/ghl-delivery-adapter-mode.js";
import { LIVE_CANARY_CONFIRMATION_TEXT } from "../../lib/ghl-delivery-adapter-mode.js";
import { evaluateLf2GhlCanaryAllowlists } from "../../lib/lf2-ghl-canary-config.js";
import {
  CLAIMABLE_INSTRUCTION_STATUSES,
  EXECUTABLE_ALLOCATION_STATUSES,
} from "./fulfillment-execution.constants.js";
import { warmEffectiveDeliveryAdapterMode } from "../delivery-runtime-mode.service.js";
import { assertLiveDeliveryAllowed, LiveDeliveryNotAllowedError } from "../delivery-guard.js";
import {
  applyDestinationFieldMappingToReadinessInput,
  clientDestinationFieldMappingFromDest,
} from "../delivery-readiness-admin.present.js";
import type { DeliveryReadinessRuleInput } from "../delivery-readiness.service.js";
import type { ClientGhlDestination } from "@prisma/client";
import {
  buildLf2GhlAdapterContext,
  loadLf2GhlInstructionBundle,
} from "./lf2-ghl-plan-context.service.js";
import { getLiveCanaryContactIdentityPreview } from "../ghl-delivery-adapter/ghl-live-canary-gates.service.js";

export type Lf2GhlCanaryPreflightResult = {
  canExecute: boolean;
  blockers: string[];
  warnings: string[];
  adapterMode: string;
  adapterKey: string | null;
  executionMode: "live";
  clientAccountId: string | null;
  leadOrderId: string | null;
  allocationStatus: string | null;
  instructionStatus: string | null;
};

export type Lf2GhlCanaryExecuteInput = {
  confirmLiveDeliveryRisk: boolean;
  operatorConfirmationText: string;
  executedBy?: string | null;
};

function lf2DestinationToReadinessInput(input: {
  clientAccountId: string;
  clientDisplayName: string | null;
  destinationSubaccountIdGhl: string;
  destination: ClientGhlDestination;
}): DeliveryReadinessRuleInput {
  const mapping = clientDestinationFieldMappingFromDest(input.destination);
  const base: DeliveryReadinessRuleInput = {
    id: `lf2:${input.clientAccountId}`,
    masterClientAccountId: input.clientAccountId,
    clientAccountId: input.clientAccountId,
    clientDisplayName: input.clientDisplayName,
    destinationSubaccountIdGhl: input.destinationSubaccountIdGhl,
    destinationWorkflowIdGhl: input.destination.destinationWorkflowIdGhl,
    destinationPipelineIdGhl: input.destination.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl: input.destination.destinationPipelineStageIdGhl,
    defaultAssignedUserIdGhl: input.destination.defaultAssignedUserIdGhl,
    backupSheetEnabled: false,
    backupSheetId: null,
    ghlConnectionStatus: input.destination.ghlConnectionStatus,
    snapshotInstalled: input.destination.snapshotInstalled,
    requiredFieldsInstalled: input.destination.requiredFieldsInstalled,
    deliveryMode: input.destination.deliveryMode,
    deliveryEnabled: input.destination.deliveryEnabled,
    clientCutoverApproved: input.destination.clientCutoverApproved,
    internalApprovalStatus: input.destination.internalApprovalStatus,
    opportunityCreationEnabled: input.destination.opportunityCreationEnabled,
    active: true,
  };
  return applyDestinationFieldMappingToReadinessInput(base, mapping);
}

export async function evaluateLf2GhlCanaryPreflight(
  deliveryInstructionId: string
): Promise<Lf2GhlCanaryPreflightResult | { notFound: true }> {
  const bundle = await loadLf2GhlInstructionBundle(deliveryInstructionId);
  if (!bundle) return { notFound: true };

  const blockers: string[] = [];
  const warnings: string[] = [];
  const runtime = await warmEffectiveDeliveryAdapterMode();
  const adapterMode = getGhlDeliveryAdapterMode();

  if (!runtime.canRunLiveCanary) {
    blockers.push(
      `Effective delivery adapter mode must be live_canary (max: ${runtime.maxAllowedMode}, effective: ${runtime.effectiveMode}). ${runtime.reason}`
    );
  }

  const { instruction, client, destination, order, sourceLeadEvent } = bundle;
  if (!client) {
    blockers.push("Client account not found.");
    return {
      canExecute: false,
      blockers,
      warnings,
      adapterMode,
      adapterKey: instruction.deliveryTarget.adapterKey,
      executionMode: "live",
      clientAccountId: null,
      leadOrderId: order.id,
      allocationStatus: instruction.leadAllocation.status,
      instructionStatus: instruction.status,
    };
  }
  if (!destination) {
    blockers.push("Client GHL destination is not configured.");
  }

  if (instruction.deliveryTarget.adapterKey !== "ghl.crm.v1") {
    blockers.push("Instruction delivery target is not ghl.crm.v1.");
  }

  if (!(CLAIMABLE_INSTRUCTION_STATUSES as readonly string[]).includes(instruction.status)) {
    if (instruction.status !== "executing") {
      blockers.push(`Instruction status ${instruction.status} is not executable.`);
    }
  }

  const allocationStatus = instruction.leadAllocation.status;
  if (!(EXECUTABLE_ALLOCATION_STATUSES as readonly string[]).includes(allocationStatus)) {
    blockers.push(`Allocation status ${allocationStatus} is not executable.`);
  }

  if (order.status !== "active") {
    blockers.push(`Lead order status ${order.status} is not active.`);
  }

  const locationId =
    typeof instruction.deliveryTarget.configMetadataJson === "object" &&
    instruction.deliveryTarget.configMetadataJson &&
    !Array.isArray(instruction.deliveryTarget.configMetadataJson)
      ? String(
          (instruction.deliveryTarget.configMetadataJson as Record<string, unknown>)
            .destinationSubaccountIdGhl ?? ""
        ).trim()
      : destination?.destinationSubaccountIdGhl ?? "";

  const allowlist = evaluateLf2GhlCanaryAllowlists({
    clientAccountId: client.clientAccountId,
    locationIdGhl: locationId,
    leadOrderId: order.id,
    sourceLane: sourceLeadEvent.sourceProvider,
  });
  blockers.push(...allowlist.blockers);

  if (destination) {
    try {
      assertLiveDeliveryAllowed(
        lf2DestinationToReadinessInput({
          clientAccountId: client.clientAccountId,
          clientDisplayName: client.clientDisplayName,
          destinationSubaccountIdGhl: locationId,
          destination,
        })
      );
    } catch (err) {
      if (err instanceof LiveDeliveryNotAllowedError) {
        blockers.push(...err.assessment.blockers);
      } else {
        blockers.push(err instanceof Error ? err.message : String(err));
      }
    }
  }

  if (destination) {
    const adapterCtx = buildLf2GhlAdapterContext({
      instruction,
      client,
      destination,
      sourceLeadEvent,
    });
    const contactPreview = getLiveCanaryContactIdentityPreview(adapterCtx.plan);
    if (contactPreview.missing.length > 0) {
      warnings.push(
        "Contact identity is incomplete. Verify name, phone, and email before live canary."
      );
    }
  }

  return {
    canExecute: blockers.length === 0,
    blockers,
    warnings,
    adapterMode,
    adapterKey: instruction.deliveryTarget.adapterKey,
    executionMode: "live",
    clientAccountId: client.clientAccountId,
    leadOrderId: order.id,
    allocationStatus,
    instructionStatus: instruction.status,
  };
}

export function validateLf2GhlCanaryExecuteBody(input: Lf2GhlCanaryExecuteInput): string[] {
  const errors: string[] = [];
  if (input.confirmLiveDeliveryRisk !== true) {
    errors.push("confirmLiveDeliveryRisk must be true.");
  }
  if (input.operatorConfirmationText.trim() !== LIVE_CANARY_CONFIRMATION_TEXT) {
    errors.push(`operatorConfirmationText must be exactly "${LIVE_CANARY_CONFIRMATION_TEXT}".`);
  }
  return errors;
}
