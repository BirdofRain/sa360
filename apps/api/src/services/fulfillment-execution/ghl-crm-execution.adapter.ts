import type { ClientGhlDestination } from "@prisma/client";

import type { DeliveryAdapterValidateResult } from "../fulfillment-shadow/delivery-adapter.registry.js";
import { executeLiveCanaryGhlSteps } from "../ghl-delivery-adapter/ghl-live-canary-executor.service.js";
import type { GhlLiveHttpDeps } from "../ghl-delivery-adapter/ghl-live-transport.js";
import { validateDeliveryPlanForGhlSimulation } from "../ghl-delivery-adapter/ghl-delivery-request-builders.js";
import type { ExecutionAdapterContract } from "./execution-adapter.registry.js";
import type { DeliveryExecutionResult, ExecutionAdapterDeliverLiveInput } from "./fulfillment-execution.types.js";
import {
  classifyGhlLiveExecutionResult,
  classifyThrownGhlExecutionError,
} from "./ghl-outcome-classifier.service.js";
import { buildLf2GhlAdapterContext } from "./lf2-ghl-plan-context.service.js";

function asClientGhlDestination(value: unknown): ClientGhlDestination | null {
  if (!value || typeof value !== "object") return null;
  return value as ClientGhlDestination;
}

async function deliverLiveGhl(input: ExecutionAdapterDeliverLiveInput): Promise<DeliveryExecutionResult> {
  const destination = asClientGhlDestination(input.destinationConfig);
  if (!destination) {
    return {
      status: "terminal_pre_send_failure",
      errorCode: "destination_not_configured",
      errorSummary: "GHL destination configuration is missing.",
      externalCallExecuted: false,
    };
  }

  const adapterCtx = buildLf2GhlAdapterContext({
    instruction: { id: input.instructionId, deliveryTarget: { configMetadataJson: {} } },
    client: {
      clientAccountId: input.clientAccountId,
      clientDisplayName: input.clientDisplayName,
    },
    destination,
    sourceLeadEvent: input.sourceLeadEvent,
    authoritativeLocationId: input.authoritativeLocationId,
  });

  const opportunityConfigured = Boolean(
    adapterCtx.rule?.destinationPipelineIdGhl && adapterCtx.rule?.destinationPipelineStageIdGhl
  );

  let externalCallMayHaveStarted = false;
  const trackingDeps: GhlLiveHttpDeps | undefined = input.deps
    ? {
        fetch: async (url, init) => {
          externalCallMayHaveStarted = true;
          return input.deps!.fetch(url, init);
        },
      }
    : undefined;

  try {
    const execution = await executeLiveCanaryGhlSteps(
      adapterCtx,
      input.idempotencyKey,
      trackingDeps ?? input.deps
    );
    externalCallMayHaveStarted =
      externalCallMayHaveStarted ||
      execution.stepOutcomes.some((step) => step.externalCallExecuted);
    return classifyGhlLiveExecutionResult(execution, { opportunityConfigured });
  } catch (err) {
    return classifyThrownGhlExecutionError(err, { externalCallMayHaveStarted });
  }
}

const ghlCrmExecutionAdapter: ExecutionAdapterContract = {
  adapterKey: "ghl.crm.v1",
  validateTarget: ({ configMetadata }): DeliveryAdapterValidateResult => {
    const locationId =
      typeof configMetadata.destinationSubaccountIdGhl === "string"
        ? configMetadata.destinationSubaccountIdGhl.trim()
        : "";
    if (!locationId) {
      return { ok: false, readinessStatus: "not_configured", reason: "missing_location_id" };
    }
    return { ok: true, readinessStatus: "ready_for_live_canary" };
  },
  buildPayload: (input) => ({
    adapterKey: "ghl.crm.v1",
    allocationId: input.allocationId,
    instructionId: input.instructionId,
    destinationSubaccountIdGhl: input.configMetadata.destinationSubaccountIdGhl ?? null,
    simulation: false,
  }),
  async simulate({ payload }) {
    return {
      ok: true,
      simulation: true,
      sanitizedResponse: {
        ...payload,
        adapterKey: "ghl.crm.v1",
        simulation: true,
        liveExecutionDeferred: true,
        note: "Use the LF2 GHL canary endpoint for guarded live execution.",
      },
      externalReference: null,
    };
  },
  deliverLive: deliverLiveGhl,
};

export { ghlCrmExecutionAdapter };

export function validateLf2GhlSimulationContext(
  ctx: Parameters<typeof validateDeliveryPlanForGhlSimulation>[0]
) {
  return validateDeliveryPlanForGhlSimulation(ctx);
}
