import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { findCorrelatedSourceLeadEvents } from "../../repositories/source-lead-event.repository.js";
import { getDuplicateRiskForRoutingDecision } from "../lead-identity/lead-identity-correlation.service.js";

export type SourceLeadDuplicateRiskSummary = {
  riskLevel: string;
  identityStatus: string;
  blocksDelivery: boolean;
  blocksLiveDelivery: boolean;
  recommendedAction: string;
  candidateCount: number;
  correlatedSourceEvents?: Array<{
    id: string;
    sourceRouteKey: string;
    status: string;
    receivedAt: string;
  }>;
  correlationReason?: string;
};

export type SourceLeadCorrelationResult = {
  correlated: boolean;
  blocksDelivery: boolean;
  correlatedEventIds: string[];
  correlatedSourceEvents: SourceLeadDuplicateRiskSummary["correlatedSourceEvents"];
  recommendedAction: string;
};

export async function evaluateSourceLeadEventCorrelation(opts: {
  sourceProvider: string;
  sourceSystem: string;
  sourceLeadId: string;
  excludeEventId: string;
  sourceLeadIdGenerated: boolean;
}): Promise<SourceLeadCorrelationResult> {
  if (opts.sourceLeadIdGenerated) {
    return {
      correlated: false,
      blocksDelivery: false,
      correlatedEventIds: [],
      correlatedSourceEvents: [],
      recommendedAction: "",
    };
  }

  const existing = await findCorrelatedSourceLeadEvents(
    opts.sourceProvider,
    opts.sourceSystem,
    opts.sourceLeadId,
    opts.excludeEventId
  );

  if (existing.length === 0) {
    return {
      correlated: false,
      blocksDelivery: false,
      correlatedEventIds: [],
      correlatedSourceEvents: [],
      recommendedAction: "",
    };
  }

  const correlatedSourceEvents = existing.map((row) => ({
    id: row.id,
    sourceRouteKey: row.sourceRouteKey ?? "",
    status: row.status,
    receivedAt: row.receivedAt.toISOString(),
  }));

  return {
    correlated: true,
    blocksDelivery: true,
    correlatedEventIds: existing.map((row) => row.id),
    correlatedSourceEvents,
    recommendedAction:
      "Correlated source lead event exists for the same provider, source system, and source lead id. Review before delivery.",
  };
}

export async function evaluateSourceLeadDuplicateRisk(opts: {
  payload: LifecycleEventSchema;
  destinationClientAccountId: string | null;
  destinationSubaccountIdGhl: string | null;
  routingDryRunDecisionId: string;
  sourceProvider?: string;
  sourceSystem?: string;
  sourceLeadId?: string;
  excludeEventId?: string;
  sourceLeadIdGenerated?: boolean;
}): Promise<SourceLeadDuplicateRiskSummary> {
  const persisted = await getDuplicateRiskForRoutingDecision(opts.routingDryRunDecisionId);
  let summary: SourceLeadDuplicateRiskSummary;

  if (persisted) {
    summary = {
      riskLevel: persisted.riskLevel,
      identityStatus: persisted.identityStatus,
      blocksDelivery: persisted.blocksLiveDelivery,
      blocksLiveDelivery: persisted.blocksLiveDelivery,
      recommendedAction: persisted.recommendedAction,
      candidateCount: persisted.candidateMatches?.length ?? 0,
    };
  } else {
    summary = {
      riskLevel: "none",
      identityStatus: "known_lead",
      blocksDelivery: false,
      blocksLiveDelivery: false,
      recommendedAction: "No duplicate risk assessment persisted.",
      candidateCount: 0,
    };
  }

  if (
    opts.sourceProvider &&
    opts.sourceSystem &&
    opts.sourceLeadId &&
    opts.excludeEventId &&
    opts.sourceLeadIdGenerated === false
  ) {
    const correlation = await evaluateSourceLeadEventCorrelation({
      sourceProvider: opts.sourceProvider,
      sourceSystem: opts.sourceSystem,
      sourceLeadId: opts.sourceLeadId,
      excludeEventId: opts.excludeEventId,
      sourceLeadIdGenerated: false,
    });

    if (correlation.correlated) {
      summary = {
        ...summary,
        riskLevel: summary.riskLevel === "none" ? "source_duplicate" : summary.riskLevel,
        blocksDelivery: true,
        blocksLiveDelivery: true,
        recommendedAction: correlation.recommendedAction,
        correlatedSourceEvents: correlation.correlatedSourceEvents,
        correlationReason: "provider_source_system_source_lead_id",
      };
    }
  }

  return summary;
}
