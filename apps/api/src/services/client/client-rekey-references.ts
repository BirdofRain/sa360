import type { Prisma, PrismaClient } from "@prisma/client";
import {
  ENRICHMENT_ASSOCIATION_CLIENT_FIELD,
  NORMALIZED_ASSOCIATION_CLIENT_FIELD,
  countEnrichmentAssociationSnapshots,
  countNormalizedAssociationSnapshots,
  migrateEnrichmentAssociationSnapshots,
  migrateNormalizedAssociationSnapshots,
} from "./client-association-snapshot.js";

export type ClientReferenceKey = {
  key: string;
  count: (
    sourceId: string,
    db: PrismaClient | Prisma.TransactionClient
  ) => Promise<number>;
  migrate: (
    sourceId: string,
    targetId: string,
    tx: Prisma.TransactionClient
  ) => Promise<number>;
};

function makeRef(
  key: string,
  delegate: keyof Prisma.TransactionClient,
  field: string
): ClientReferenceKey {
  return {
    key,
    count: async (sourceId, db) => {
      const model = db[delegate] as unknown as {
        count: (args: { where: Record<string, string> }) => Promise<number>;
      };
      return model.count({ where: { [field]: sourceId } });
    },
    migrate: async (sourceId, targetId, tx) => {
      const model = tx[delegate] as unknown as {
        updateMany: (args: {
          where: Record<string, string>;
          data: Record<string, string>;
        }) => Promise<{ count: number }>;
      };
      const result = await model.updateMany({
        where: { [field]: sourceId },
        data: { [field]: targetId },
      });
      return result.count;
    },
  };
}

export const SOURCE_FUNNEL_ORIGIN_REFERENCE_KEY = "SourceFunnel.originClientAccountId";
export const SOURCE_FUNNEL_SUGGESTED_REFERENCE_KEY = "SourceFunnel.suggestedClientAccountId";
export const SOURCE_LEAD_RESOLVED_REFERENCE_KEY = "SourceLeadEvent.clientAccountIdResolved";

/**
 * Scalar client-account references migrated during rekey.
 * Current association snapshots are updated before `clientAccountIdResolved`
 * so the snapshot write still sees the source id. Historical `associationAudit`
 * entries are not part of this list.
 */
export const CLIENT_IDENTITY_REFERENCE_UPDATES: ClientReferenceKey[] = [
  makeRef("ClientOnboardingSetup.clientAccountId", "clientOnboardingSetup", "clientAccountId"),
  makeRef(
    "ClientOnboardingSetupAuditEvent.clientAccountId",
    "clientOnboardingSetupAuditEvent",
    "clientAccountId"
  ),
  makeRef("ClientConfig.clientAccountId", "clientConfig", "clientAccountId"),
  makeRef("LifecycleEvent.clientAccountId", "lifecycleEvent", "clientAccountId"),
  makeRef("WebhookRequestLog.clientAccountId", "webhookRequestLog", "clientAccountId"),
  makeRef("SynthflowRequestLog.clientAccountId", "synthflowRequestLog", "clientAccountId"),
  makeRef(
    "SynthflowOutboundResultLog.clientAccountId",
    "synthflowOutboundResultLog",
    "clientAccountId"
  ),
  makeRef("InboundContactIndex.clientAccountId", "inboundContactIndex", "clientAccountId"),
  makeRef("GuidanceResource.clientAccountId", "guidanceResource", "clientAccountId"),
  makeRef("ObjectionPlaybook.clientAccountId", "objectionPlaybook", "clientAccountId"),
  makeRef("ClientScriptAssignment.clientAccountId", "clientScriptAssignment", "clientAccountId"),
  makeRef("ContactGuidanceEvent.clientAccountId", "contactGuidanceEvent", "clientAccountId"),
  makeRef("AgentWorkspaceAction.clientAccountId", "agentWorkspaceAction", "clientAccountId"),
  makeRef("CampaignRoutingRule.clientAccountId", "campaignRoutingRule", "clientAccountId"),
  makeRef(
    "RoutingDryRunDecision.destinationClientAccountId",
    "routingDryRunDecision",
    "destinationClientAccountId"
  ),
  makeRef(
    "RoutingDryRunDecision.legacyDeliveredClientAccountId",
    "routingDryRunDecision",
    "legacyDeliveredClientAccountId"
  ),
  makeRef("LeadDeliveryPlan.destinationClientAccountId", "leadDeliveryPlan", "destinationClientAccountId"),
  makeRef(
    "GhlDeliveryAdapterRun.destinationClientAccountId",
    "ghlDeliveryAdapterRun",
    "destinationClientAccountId"
  ),
  makeRef(
    "GhlLiveDeliveryRun.destinationClientAccountId",
    "ghlLiveDeliveryRun",
    "destinationClientAccountId"
  ),
  makeRef(
    "LeadDuplicateRiskAssessment.destinationClientAccountId",
    "leadDuplicateRiskAssessment",
    "destinationClientAccountId"
  ),
  makeRef("GhlLocationConnection.clientAccountId", "ghlLocationConnection", "clientAccountId"),
  makeRef("GhlOAuthPendingInstall.clientAccountId", "ghlOAuthPendingInstall", "clientAccountId"),
  makeRef("GhlLocationConfigSnapshot.clientAccountId", "ghlLocationConfigSnapshot", "clientAccountId"),
  makeRef("SupportTicket.clientAccountId", "supportTicket", "clientAccountId"),
  makeRef(SOURCE_FUNNEL_ORIGIN_REFERENCE_KEY, "sourceFunnel", "originClientAccountId"),
  makeRef(SOURCE_FUNNEL_SUGGESTED_REFERENCE_KEY, "sourceFunnel", "suggestedClientAccountId"),
  {
    key: ENRICHMENT_ASSOCIATION_CLIENT_FIELD,
    count: countEnrichmentAssociationSnapshots,
    migrate: migrateEnrichmentAssociationSnapshots,
  },
  {
    key: NORMALIZED_ASSOCIATION_CLIENT_FIELD,
    count: countNormalizedAssociationSnapshots,
    migrate: migrateNormalizedAssociationSnapshots,
  },
  makeRef(SOURCE_LEAD_RESOLVED_REFERENCE_KEY, "sourceLeadEvent", "clientAccountIdResolved"),
  makeRef(
    "BulkLeadImport.destinationClientAccountId",
    "bulkLeadImport",
    "destinationClientAccountId"
  ),
];

export async function countClientIdentityReferences(
  sourceClientAccountId: string,
  db: PrismaClient | Prisma.TransactionClient
): Promise<Record<string, number>> {
  const references: Record<string, number> = {};
  for (const ref of CLIENT_IDENTITY_REFERENCE_UPDATES) {
    references[ref.key] = await ref.count(sourceClientAccountId, db);
  }
  return references;
}

export async function migrateClientIdentityReferences(
  sourceClientAccountId: string,
  targetClientAccountId: string,
  tx: Prisma.TransactionClient
): Promise<Record<string, number>> {
  const moved: Record<string, number> = {};
  for (const ref of CLIENT_IDENTITY_REFERENCE_UPDATES) {
    moved[ref.key] = await ref.migrate(sourceClientAccountId, targetClientAccountId, tx);
  }
  return moved;
}
