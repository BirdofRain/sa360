import { prisma } from "../../lib/db.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { countRoutingRulesForClient } from "../../repositories/campaign-routing-rule.repository.js";
import {
  ENRICHMENT_ASSOCIATION_CLIENT_FIELD,
  NORMALIZED_ASSOCIATION_CLIENT_FIELD,
  listInconsistentCurrentAssociationSnapshots,
  type AssociationSnapshotField,
} from "./client-association-snapshot.js";

export type SourceFunnelReferenceField = "originClientAccountId" | "suggestedClientAccountId";

export type ClientDeletionAffectedRow = {
  id: string;
  kind: "source_funnel";
  originClientAccountId: string | null;
  suggestedClientAccountId: string | null;
  referencedFields: SourceFunnelReferenceField[];
};

export type ClientDeletionAssociationSnapshotRow = {
  id: string;
  kind: "association_snapshot";
  clientAccountIdResolved: string | null;
  referencedFields: AssociationSnapshotField[];
};

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
    onboardingSetups: number;
    onboardingAuditEventsRetained: number;
    sourceFunnelOriginReferences: number;
    sourceFunnelSuggestedReferences: number;
    sourceFunnelRows: number;
    inconsistentAssociationEnrichmentSnapshots: number;
    inconsistentAssociationNormalizedSnapshots: number;
    inconsistentAssociationSnapshotRows: number;
  };
  /** SourceFunnel rows that name this client. A row using both fields appears once. */
  affectedRows: ClientDeletionAffectedRow[];
  /**
   * Events whose current association snapshot names this client while
   * `clientAccountIdResolved` does not. One event using both JSON fields appears once.
   */
  associationSnapshotRows: ClientDeletionAssociationSnapshotRow[];
  blockers: string[];
  blocked: boolean;
  warning: string;
};

export function summarizeSourceFunnelClientReferences(
  clientAccountId: string,
  rows: Array<{
    id: string;
    originClientAccountId: string | null;
    suggestedClientAccountId: string | null;
  }>
): {
  originReferences: number;
  suggestedReferences: number;
  affectedRows: ClientDeletionAffectedRow[];
} {
  const affectedRows: ClientDeletionAffectedRow[] = [];
  let originReferences = 0;
  let suggestedReferences = 0;
  for (const row of rows) {
    const referencedFields: SourceFunnelReferenceField[] = [];
    if (row.originClientAccountId === clientAccountId) {
      originReferences += 1;
      referencedFields.push("originClientAccountId");
    }
    if (row.suggestedClientAccountId === clientAccountId) {
      suggestedReferences += 1;
      referencedFields.push("suggestedClientAccountId");
    }
    if (referencedFields.length === 0) continue;
    affectedRows.push({
      id: row.id,
      kind: "source_funnel",
      originClientAccountId: row.originClientAccountId,
      suggestedClientAccountId: row.suggestedClientAccountId,
      referencedFields,
    });
  }
  return { originReferences, suggestedReferences, affectedRows };
}

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
    onboardingSetups,
    onboardingAuditEventsRetained,
    sourceFunnels,
    inconsistentSnapshots,
  ] = await Promise.all([
    countRoutingRulesForClient(id),
    prisma.ghlLocationConnection.count({ where: { clientAccountId: id } }),
    prisma.sourceLeadEvent.count({ where: { clientAccountIdResolved: id } }),
    prisma.bulkLeadImport.count({ where: { destinationClientAccountId: id } }),
    prisma.ghlDeliveryAdapterRun.count({ where: { destinationClientAccountId: id } }),
    prisma.ghlLiveDeliveryRun.count({ where: { destinationClientAccountId: id } }),
    prisma.clientOnboardingSetup.count({ where: { clientAccountId: id } }),
    prisma.clientOnboardingSetupAuditEvent.count({ where: { clientAccountId: id } }),
    prisma.sourceFunnel.findMany({
      where: {
        OR: [{ originClientAccountId: id }, { suggestedClientAccountId: id }],
      },
      select: {
        id: true,
        originClientAccountId: true,
        suggestedClientAccountId: true,
      },
      orderBy: { id: "asc" },
    }),
    listInconsistentCurrentAssociationSnapshots(id, prisma),
  ]);
  const funnelReferences = summarizeSourceFunnelClientReferences(id, sourceFunnels);
  const associationSnapshotRows = inconsistentSnapshots.rows.map((row) => ({
    kind: "association_snapshot" as const,
    id: row.id,
    clientAccountIdResolved: row.clientAccountIdResolved,
    referencedFields: row.referencedFields,
  }));

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
  if (funnelReferences.affectedRows.length > 0) {
    blockers.push(
      `${funnelReferences.affectedRows.length} SourceFunnel row(s) reference this client (${funnelReferences.originReferences} origin, ${funnelReferences.suggestedReferences} suggested).`
    );
  }
  if (associationSnapshotRows.length > 0) {
    blockers.push(
      `${associationSnapshotRows.length} Source Intake event(s) have a current association snapshot for this client that does not match clientAccountIdResolved (${inconsistentSnapshots.enrichmentReferences} ${ENRICHMENT_ASSOCIATION_CLIENT_FIELD}, ${inconsistentSnapshots.normalizedReferences} ${NORMALIZED_ASSOCIATION_CLIENT_FIELD}). Deletion would leave that snapshot inconsistent.`
    );
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
      onboardingSetups,
      onboardingAuditEventsRetained,
      sourceFunnelOriginReferences: funnelReferences.originReferences,
      sourceFunnelSuggestedReferences: funnelReferences.suggestedReferences,
      sourceFunnelRows: funnelReferences.affectedRows.length,
      inconsistentAssociationEnrichmentSnapshots: inconsistentSnapshots.enrichmentReferences,
      inconsistentAssociationNormalizedSnapshots: inconsistentSnapshots.normalizedReferences,
      inconsistentAssociationSnapshotRows: associationSnapshotRows.length,
    },
    affectedRows: funnelReferences.affectedRows,
    associationSnapshotRows,
    blockers,
    blocked: blockers.length > 0,
    warning: [
      "Deleting and recreating a client with the same display name creates a different SA360 identity.",
      onboardingSetups > 0
        ? "The mutable onboarding setup document will be deleted."
        : "No mutable onboarding setup document exists.",
      `${onboardingAuditEventsRetained} onboarding audit event(s) will be retained with the historical client identity.`,
    ].join(" "),
  };
}
