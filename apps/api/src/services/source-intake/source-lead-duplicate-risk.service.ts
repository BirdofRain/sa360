import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { getDuplicateRiskForRoutingDecision } from "../lead-identity/lead-identity-correlation.service.js";

export type SourceLeadDuplicateRiskSummary = {
  riskLevel: string;
  identityStatus: string;
  blocksDelivery: boolean;
  blocksLiveDelivery: boolean;
  recommendedAction: string;
  candidateCount: number;
};

export async function evaluateSourceLeadDuplicateRisk(opts: {
  payload: LifecycleEventSchema;
  destinationClientAccountId: string | null;
  destinationSubaccountIdGhl: string | null;
  routingDryRunDecisionId: string;
}): Promise<SourceLeadDuplicateRiskSummary> {
  const persisted = await getDuplicateRiskForRoutingDecision(opts.routingDryRunDecisionId);
  if (persisted) {
    return {
      riskLevel: persisted.riskLevel,
      identityStatus: persisted.identityStatus,
      blocksDelivery: persisted.blocksLiveDelivery,
      blocksLiveDelivery: persisted.blocksLiveDelivery,
      recommendedAction: persisted.recommendedAction,
      candidateCount: persisted.candidateMatches?.length ?? 0,
    };
  }

  return {
    riskLevel: "none",
    identityStatus: "known_lead",
    blocksDelivery: false,
    blocksLiveDelivery: false,
    recommendedAction: "No duplicate risk assessment persisted.",
    candidateCount: 0,
  };
}
