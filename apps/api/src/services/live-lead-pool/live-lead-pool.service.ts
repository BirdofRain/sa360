import type { Prisma, PrismaClient, SourceLeadEventStatus } from "@prisma/client";
import { prisma } from "../../lib/db.js";
import { getLeadProofByLeadUid } from "../../repositories/lead-proof.repository.js";

export type LiveLeadPoolFilters = {
  clientAccountId?: string;
  campaignId?: string;
  nicheKey?: string;
  status?: SourceLeadEventStatus;
  sourceSystem?: string;
  unmatchedOnly?: boolean;
  demandType?: "pay_per_lead" | "retainer_allocation";
  proofStatus?: string;
  receivedAfter?: Date;
  receivedBefore?: Date;
  limit?: number;
};

export type LiveLeadPoolItem = {
  sourceEventId: string;
  receivedAt: string;
  sourceSystem: string;
  sourceProvider: string;
  sourceCampaignId: string | null;
  sourceFunnelName: string | null;
  sourceLeadId: string | null;
  nicheKey: string | null;
  clientAccountId: string | null;
  destinationLocationIdGhl: string | null;
  status: SourceLeadEventStatus;
  matched: boolean;
  orderId: string | null;
  orderKind: string | null;
  allocationStatus: string | null;
  proofStatus: string | null;
  duplicateBlocked: boolean;
};

export type LiveLeadPoolSummary = {
  totalLeadsReceived: number;
  unmatchedLeads: number;
  allocatedLeads: number;
  deliveredLeads: number;
  failedLeads: number;
  proofCompleteLeads: number;
  proofMissingLeads: number;
  byCampaign: Record<string, number>;
  byNiche: Record<string, number>;
  byClient: Record<string, number>;
};

function readNiche(enrichment: unknown, normalized: unknown): string | null {
  const e = enrichment && typeof enrichment === "object" ? (enrichment as Record<string, unknown>) : {};
  const n = normalized && typeof normalized === "object" ? (normalized as Record<string, unknown>) : {};
  const routing = n.routing && typeof n.routing === "object" ? (n.routing as Record<string, unknown>) : {};
  const niche =
    (typeof e.nicheKey === "string" && e.nicheKey) ||
    (typeof routing.niche_key === "string" && routing.niche_key) ||
    null;
  return niche;
}

function buildWhere(filters: LiveLeadPoolFilters): Prisma.SourceLeadEventWhereInput {
  const where: Prisma.SourceLeadEventWhereInput = {
    cleanupStatus: null,
  };
  if (filters.clientAccountId?.trim()) {
    where.clientAccountIdResolved = filters.clientAccountId.trim();
  }
  if (filters.campaignId?.trim()) {
    where.sourceCampaignId = filters.campaignId.trim();
  }
  if (filters.status) where.status = filters.status;
  if (filters.sourceSystem?.trim()) {
    where.sourceSystem = filters.sourceSystem.trim() as Prisma.EnumSourceLeadSystemFilter["equals"];
  }
  if (filters.unmatchedOnly) {
    where.status = { in: ["routing_unmatched", "needs_review", "received"] };
    where.clientAccountIdResolved = null;
  }
  if (filters.receivedAfter || filters.receivedBefore) {
    where.receivedAt = {};
    if (filters.receivedAfter) where.receivedAt.gte = filters.receivedAfter;
    if (filters.receivedBefore) where.receivedAt.lte = filters.receivedBefore;
  }
  if (filters.demandType) {
    where.leadAllocations = {
      some: { leadOrder: { orderKind: filters.demandType } },
    };
  }
  return where;
}

export async function getLiveLeadPoolSummary(
  filters: LiveLeadPoolFilters = {},
  db: PrismaClient = prisma
): Promise<LiveLeadPoolSummary> {
  const where = buildWhere(filters);
  const rows = await db.sourceLeadEvent.findMany({
    where,
    select: {
      id: true,
      status: true,
      sourceCampaignId: true,
      clientAccountIdResolved: true,
      sourceLeadUid: true,
      enrichmentMetadataJson: true,
      normalizedPayloadJson: true,
      leadAllocations: { select: { id: true }, take: 1 },
    },
    take: 5000,
    orderBy: { receivedAt: "desc" },
  });

  const byCampaign: Record<string, number> = {};
  const byNiche: Record<string, number> = {};
  const byClient: Record<string, number> = {};
  let unmatchedLeads = 0;
  let allocatedLeads = 0;
  let deliveredLeads = 0;
  let failedLeads = 0;
  let proofCompleteLeads = 0;
  let proofMissingLeads = 0;

  const leadUids = rows
    .map((row) => row.sourceLeadUid?.trim())
    .filter((uid): uid is string => Boolean(uid));
  const proofs =
    leadUids.length === 0
      ? []
      : await db.leadProof.findMany({
          where: { leadUid: { in: leadUids } },
          select: { leadUid: true, proofStatus: true },
        });
  const proofByUid = new Map(proofs.map((p) => [p.leadUid, p.proofStatus]));

  for (const row of rows) {
    const campaign = row.sourceCampaignId?.trim() || "unknown";
    byCampaign[campaign] = (byCampaign[campaign] ?? 0) + 1;
    const niche = readNiche(row.enrichmentMetadataJson, row.normalizedPayloadJson) ?? "unknown";
    byNiche[niche] = (byNiche[niche] ?? 0) + 1;
    const client = row.clientAccountIdResolved?.trim() || "unmatched";
    byClient[client] = (byClient[client] ?? 0) + 1;

    if (!row.clientAccountIdResolved || row.status === "routing_unmatched") unmatchedLeads += 1;
    if (row.leadAllocations.length > 0) allocatedLeads += 1;
    if (row.status === "delivered") deliveredLeads += 1;
    if (row.status === "delivery_failed") failedLeads += 1;

    if (!row.sourceLeadUid) {
      proofMissingLeads += 1;
      continue;
    }
    const proofStatus = proofByUid.get(row.sourceLeadUid);
    if (proofStatus === "PROOF_ATTACHED") proofCompleteLeads += 1;
    else proofMissingLeads += 1;
  }

  return {
    totalLeadsReceived: rows.length,
    unmatchedLeads,
    allocatedLeads,
    deliveredLeads,
    failedLeads,
    proofCompleteLeads,
    proofMissingLeads,
    byCampaign,
    byNiche,
    byClient,
  };
}

export async function listLiveLeadPool(
  filters: LiveLeadPoolFilters = {},
  db: PrismaClient = prisma
): Promise<{ items: LiveLeadPoolItem[]; summary: LiveLeadPoolSummary }> {
  const where = buildWhere(filters);
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const rows = await db.sourceLeadEvent.findMany({
    where,
    orderBy: { receivedAt: "desc" },
    take: limit,
    include: {
      leadAllocations: {
        orderBy: { proposedAt: "desc" },
        take: 1,
        include: { leadOrder: { select: { id: true, orderKind: true } } },
      },
    },
  });

  const items: LiveLeadPoolItem[] = [];
  for (const row of rows) {
    const allocation = row.leadAllocations[0] ?? null;
    let proofStatus: string | null = null;
    if (row.sourceLeadUid) {
      const proof = await getLeadProofByLeadUid(row.sourceLeadUid, db);
      proofStatus = proof?.proofStatus ?? null;
    }
    if (filters.proofStatus && proofStatus !== filters.proofStatus) continue;
    if (filters.nicheKey) {
      const niche = readNiche(row.enrichmentMetadataJson, row.normalizedPayloadJson);
      if ((niche ?? "").toLowerCase() !== filters.nicheKey.trim().toLowerCase()) continue;
    }

    items.push({
      sourceEventId: row.id,
      receivedAt: row.receivedAt.toISOString(),
      sourceSystem: row.sourceSystem,
      sourceProvider: row.sourceProvider,
      sourceCampaignId: row.sourceCampaignId,
      sourceFunnelName: row.sourceFunnelName,
      sourceLeadId: row.sourceLeadId,
      nicheKey: readNiche(row.enrichmentMetadataJson, row.normalizedPayloadJson),
      clientAccountId: row.clientAccountIdResolved,
      destinationLocationIdGhl: row.destinationLocationIdResolved,
      status: row.status,
      matched: Boolean(row.routingRuleIdResolved && row.clientAccountIdResolved),
      orderId: allocation?.leadOrderId ?? null,
      orderKind: allocation?.leadOrder?.orderKind ?? null,
      allocationStatus: allocation?.status ?? null,
      proofStatus,
      duplicateBlocked: row.status === "duplicate_blocked",
    });
  }

  const summary = await getLiveLeadPoolSummary(filters, db);
  return { items, summary };
}
