import type { Prisma, PrismaClient } from "@prisma/client";

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

/** Scalar client-account references migrated during rekey. */
export const CLIENT_IDENTITY_REFERENCE_UPDATES: ClientReferenceKey[] = [
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
  makeRef("SourceLeadEvent.clientAccountIdResolved", "sourceLeadEvent", "clientAccountIdResolved"),
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
