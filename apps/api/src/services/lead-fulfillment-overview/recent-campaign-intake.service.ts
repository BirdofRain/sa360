import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "../../lib/db.js";
import {
  deriveRecentIntakeLifecycle,
  isGeneratedAtMissingFromEnrichment,
  RECENT_INTAKE_LIFECYCLE_LABELS,
  type RecentIntakeLifecycle,
} from "./recent-intake-lifecycle.js";

export const RECENT_CAMPAIGN_INTAKE_LIMIT = 25;

export type RecentCampaignIntakeRow = {
  leadUid: string;
  sourceLane: string;
  state: string;
  niche: string;
  proofStatus: string;
  verificationStatus: string;
  inventoryStatus: string;
  inventoryLifecycle: RecentIntakeLifecycle;
  inventoryLifecycleLabel: string;
  generatedAt: string | null;
  ageDays: number | null;
  createdAt: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function formatSourceLane(sourceLane: string | null, provider: string, system: string): string {
  if (sourceLane === "meta_lead_ads") return "Meta Lead Ads";
  if (sourceLane === "leadcapture_io") return "LeadCapture.io";
  if (sourceLane === "leadconduit_facebook") return "LeadConduit Facebook";
  if (sourceLane && sourceLane !== "unknown") return sourceLane;
  if (provider === "facebook" || provider === "meta") return "Meta Lead Ads";
  if (provider === "leadcapture" || system.includes("leadcapture")) return "LeadCapture.io";
  return `${provider}/${system}`;
}

function presentProofStatus(status: string | undefined): string {
  switch (status) {
    case "PROOF_ATTACHED":
      return "attached";
    case "PROOF_MISSING":
      return "missing";
    case "NEEDS_REVIEW":
      return "needs_review";
    case "REJECTED":
      return "rejected";
    default:
      return "missing";
  }
}

function presentVerificationStatus(status: string | undefined): string {
  switch (status) {
    case "PASSED":
      return "passed";
    case "FAILED":
      return "failed";
    case "NEEDS_REVIEW":
      return "needs_review";
    default:
      return "unchecked";
  }
}

function extractStateNiche(payload: Prisma.JsonValue | null, item: {
  normalizedState: string;
  nicheKey: string;
} | null): { state: string; niche: string } {
  if (item) {
    return { state: item.normalizedState || "—", niche: item.nicheKey || "—" };
  }
  const rec = asRecord(payload);
  const contact = rec ? asRecord(rec.contact) : null;
  const routing = rec ? asRecord(rec.routing) : null;
  const classification = rec ? asRecord(rec.classification) : null;
  const sourceIntake = routing ? asRecord(routing.source_intake) : null;
  return {
    state:
      readString(contact?.state, sourceIntake?.state, routing?.state, rec?.state) ?? "—",
    niche:
      readString(
        classification?.niche_key,
        routing?.niche_key,
        sourceIntake?.niche_key,
        rec?.niche_key
      ) ?? "—",
  };
}

/**
 * Bounded recent intake from SourceLeadEvent + inventory relationship.
 * take=25. Batched proof/verification by leadUid IN (...). No inventory corpus scan.
 */
export async function loadRecentCampaignIntake(
  db: PrismaClient = defaultPrisma,
  options?: { limit?: number; evaluatedAt?: Date }
): Promise<
  | { ok: true; rows: RecentCampaignIntakeRow[] }
  | { ok: false; error: string }
> {
  const limit = Math.min(options?.limit ?? RECENT_CAMPAIGN_INTAKE_LIMIT, RECENT_CAMPAIGN_INTAKE_LIMIT);
  const evaluatedAt = options?.evaluatedAt ?? new Date();

  try {
    const events = await db.sourceLeadEvent.findMany({
      take: limit,
      orderBy: { receivedAt: "desc" },
      select: {
        id: true,
        sourceLeadUid: true,
        sourceProvider: true,
        sourceSystem: true,
        receivedAt: true,
        normalizedPayloadJson: true,
        enrichmentMetadataJson: true,
        leadInventoryItem: {
          select: {
            id: true,
            status: true,
            generatedAt: true,
            normalizedState: true,
            nicheKey: true,
            sourceLane: true,
          },
        },
      },
    });

    const leadUids = events
      .map((row) => row.sourceLeadUid?.trim())
      .filter((uid): uid is string => Boolean(uid));

    const [proofs, verifications] = await Promise.all([
      leadUids.length > 0
        ? db.leadProof.findMany({
            where: { leadUid: { in: leadUids } },
            select: { leadUid: true, proofStatus: true },
          })
        : Promise.resolve([]),
      leadUids.length > 0
        ? db.leadVerificationResult.findMany({
            where: { leadUid: { in: leadUids } },
            select: { leadUid: true, verificationStatus: true },
          })
        : Promise.resolve([]),
    ]);

    const proofByUid = new Map(proofs.map((row) => [row.leadUid, row.proofStatus]));
    const verificationByUid = new Map(
      verifications.map((row) => [row.leadUid, row.verificationStatus])
    );

    const rows = events.map((event): RecentCampaignIntakeRow => {
      const item = event.leadInventoryItem;
      const enrichment = asRecord(event.enrichmentMetadataJson);
      const sourceLane = formatSourceLane(
        item?.sourceLane ?? (typeof enrichment?.sourceLane === "string" ? enrichment.sourceLane : null),
        event.sourceProvider,
        event.sourceSystem
      );
      const { state, niche } = extractStateNiche(event.normalizedPayloadJson, item);
      const lifecycle = deriveRecentIntakeLifecycle({
        hasInventoryItem: Boolean(item),
        generatedAtMissing: isGeneratedAtMissingFromEnrichment(event.enrichmentMetadataJson),
        inventoryStatus: item?.status ?? null,
        generatedAt: item?.generatedAt ?? null,
        evaluatedAt,
      });
      const leadUid = event.sourceLeadUid?.trim() || event.id;
      return {
        leadUid,
        sourceLane,
        state,
        niche,
        proofStatus: presentProofStatus(proofByUid.get(leadUid)),
        verificationStatus: presentVerificationStatus(verificationByUid.get(leadUid)),
        inventoryStatus: lifecycle,
        inventoryLifecycle: lifecycle,
        inventoryLifecycleLabel: RECENT_INTAKE_LIFECYCLE_LABELS[lifecycle],
        generatedAt: item?.generatedAt?.toISOString() ?? null,
        ageDays:
          item?.generatedAt != null
            ? Math.floor((evaluatedAt.getTime() - item.generatedAt.getTime()) / 86_400_000)
            : null,
        createdAt: event.receivedAt.toISOString(),
      };
    });

    return { ok: true, rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "recent_intake_unavailable" };
  }
}
