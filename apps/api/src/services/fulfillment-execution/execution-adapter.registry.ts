import type { DeliveryAdapterValidateResult } from "../fulfillment-shadow/delivery-adapter.registry.js";
import { ghlCrmExecutionAdapter } from "./ghl-crm-execution.adapter.js";

export type ExecutionAdapterSimulateResult =
  | {
      ok: true;
      simulation: true;
      sanitizedResponse: Record<string, unknown>;
      externalReference: string | null;
    }
  | {
      ok: false;
      simulation: true;
      errorCode: string;
      errorSummary: string;
      retryable: boolean;
    };

export type ExecutionAdapterContract = {
  adapterKey: string;
  validateTarget: (input: {
    configMetadata: Record<string, unknown>;
  }) => DeliveryAdapterValidateResult;
  buildPayload: (input: {
    allocationId: string;
    instructionId: string;
    configMetadata: Record<string, unknown>;
  }) => Record<string, unknown>;
  simulate: (input: {
    payload: Record<string, unknown>;
  }) => Promise<ExecutionAdapterSimulateResult>;
};

const testSimulatedAdapter: ExecutionAdapterContract = {
  adapterKey: "test.simulated.v1",
  validateTarget: () => ({ ok: true, readinessStatus: "ready_for_simulation" }),
  buildPayload: (input) => ({
    adapterKey: "test.simulated.v1",
    allocationId: input.allocationId,
    instructionId: input.instructionId,
    simulation: true,
  }),
  async simulate({ payload }) {
    return {
      ok: true,
      simulation: true,
      sanitizedResponse: { ...payload, simulatedAt: new Date().toISOString() },
      externalReference: `sim:${payload.instructionId as string}`,
    };
  },
};

const EXECUTION_REGISTRY = new Map<string, ExecutionAdapterContract>([
  [testSimulatedAdapter.adapterKey, testSimulatedAdapter],
  [ghlCrmExecutionAdapter.adapterKey, ghlCrmExecutionAdapter],
]);

export function registerExecutionAdapter(adapter: ExecutionAdapterContract): void {
  EXECUTION_REGISTRY.set(adapter.adapterKey, adapter);
}

export function getExecutionAdapter(adapterKey: string): ExecutionAdapterContract | null {
  return EXECUTION_REGISTRY.get(adapterKey.trim()) ?? null;
}

export function listRegisteredExecutionAdapterKeys(): string[] {
  return [...EXECUTION_REGISTRY.keys()].sort();
}
