import { LIVE_CANARY_CONFIRMATION_TEXT } from "../../lib/ghl-delivery-adapter-mode.js";

export type {
  Lf2GhlCanaryGateEvaluation,
  Lf2GhlCanaryPreflightResult,
  Lf2AllowlistGateResults,
} from "./lf2-ghl-canary-gate-evaluation.service.js";
export {
  evaluateLf2GhlCanaryPreflight,
  evaluateLf2GhlCanaryWriteBoundaryGates,
  evaluateLf2GhlCanaryGates,
} from "./lf2-ghl-canary-gate-evaluation.service.js";

export type Lf2GhlCanaryExecuteInput = {
  confirmLiveDeliveryRisk: boolean;
  operatorConfirmationText: string;
  executedBy?: string | null;
};

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
