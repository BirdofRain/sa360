import { prisma } from "../../lib/db.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { countRoutingRulesForClient } from "../../repositories/campaign-routing-rule.repository.js";

export type ClientDeletionImpact = {
  clientAccountId: string;
  clientDisplayName: string;
  counts: {
    routingRules: number;
    ghlConnections: number;
    hasDestination: boolean;
    sourceEvents: number;
    bulkImports: number;
    deliveryAdapterRuns: number;
    liveDeliveryRuns: number;
    portalEnabled: boolean;
  };
  blockers: string[];
  blocked: boolean;
  warning: string;
};

const DELETION_WARNING =
  "Deleting and recreating a client with the same display name creates a different SA360 identity.";

export async function getClientDeletionImpact(
  clientAccountId: string
): Promise<ClientDeletionImpact | { notFound: true }> {
  const id = clientAccountId.trim();
  const client = await findClientAccountById(id);
  if (!client) return { notFound: true };

  const [
    routingRules,
    ghlConnections,
    sourceEvents,
    bulkImports,
    deliveryAdapterRuns,
    liveDeliveryRuns,
  ] = await Promise.all([
    countRoutingRulesForClient(id),
    prisma.ghlLocationConnection.count({ where: { clientAccountId: id } }),
    prisma.sourceLeadEvent.count({ where: { clientAccountIdResolved: id } }),
    prisma.bulkLeadImport.count({ where: { destinationClientAccountId: id } }),
    prisma.ghlDeliveryAdapterRun.count({ where: { destinationClientAccountId: id } }),
    prisma.ghlLiveDeliveryRun.count({ where: { destinationClientAccountId: id } }),
  ]);

  const blockers: string[] = [];
  if (client.ghlDestination) {
    blockers.push("GHL destination configuration exists for this client.");
  }
  if (ghlConnections > 0) {
    blockers.push(`${ghlConnections} linked GHL connection(s).`);
  }
  if (routingRules > 0) {
    blockers.push(`${routingRules} routing rule(s).`);
  }
  if (sourceEvents > 0) {
    blockers.push(`${sourceEvents} Source Intake event(s) reference this client.`);
  }
  if (bulkImports > 0) {
    blockers.push(`${bulkImports} bulk import batch(es) reference this client.`);
  }
  if (deliveryAdapterRuns > 0 || liveDeliveryRuns > 0) {
    blockers.push(
      `${deliveryAdapterRuns + liveDeliveryRuns} delivery run record(s) reference this client.`
    );
  }
  if (client.portalEnabled) {
    blockers.push("Client portal is enabled for this account.");
  }

  return {
    clientAccountId: id,
    clientDisplayName: client.clientDisplayName,
    counts: {
      routingRules,
      ghlConnections,
      hasDestination: Boolean(client.ghlDestination),
      sourceEvents,
      bulkImports,
      deliveryAdapterRuns,
      liveDeliveryRuns,
      portalEnabled: client.portalEnabled,
    },
    blockers,
    blocked: blockers.length > 0,
    warning: DELETION_WARNING,
  };
}
