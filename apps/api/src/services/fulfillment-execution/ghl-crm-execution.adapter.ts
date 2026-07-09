import type { DeliveryAdapterValidateResult } from "../fulfillment-shadow/delivery-adapter.registry.js";
import type { ExecutionAdapterContract } from "./execution-adapter.registry.js";
import { validateDeliveryPlanForGhlSimulation } from "../ghl-delivery-adapter/ghl-delivery-request-builders.js";

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
};

export { ghlCrmExecutionAdapter };

export function validateLf2GhlSimulationContext(
  ctx: Parameters<typeof validateDeliveryPlanForGhlSimulation>[0]
) {
  return validateDeliveryPlanForGhlSimulation(ctx);
}
