import { prisma } from "../../lib/db.js";
import type { ClientChannelApplyScope } from "./client-channel-profile.constants.js";

export type ChannelProfileImpactBucket = {
  /** Numeric estimate, or null when the local index cannot express this concept yet. */
  count: number | null;
  note?: string;
};

export type ChannelProfileImpactPreview = {
  available: boolean;
  message: string;
  applyScope: ClientChannelApplyScope | null;
  dataSource: "inbound_contact_index" | null;
  totalIndexedContacts: number;
  buckets: {
    newLeadsAffected: ChannelProfileImpactBucket;
    activeLockedLeadsAffected: ChannelProfileImpactBucket;
    activeUnlockedLeadsAffected: ChannelProfileImpactBucket;
    eligibleForRecalculation: ChannelProfileImpactBucket;
    requiresReview: ChannelProfileImpactBucket;
    skippedChannelLocked: ChannelProfileImpactBucket;
    skippedDncDeadOrBadNumber: ChannelProfileImpactBucket;
  };
  notes: string[];
};

const UNAVAILABLE_MESSAGE =
  "Impact preview unavailable until lead index/admin contact data is available.";

const DEAD_OR_DNC_KEYWORDS = ["dead", "dnc", "do_not_contact", "do not contact", "bad", "invalid"];

function looksDeadOrBad(...values: (string | null | undefined)[]): boolean {
  const hay = values
    .filter((v): v is string => Boolean(v))
    .join(" ")
    .toLowerCase();
  return DEAD_OR_DNC_KEYWORDS.some((k) => hay.includes(k));
}

/**
 * Read-only impact estimate for applying a channel profile to existing leads. Never mutates data.
 *
 * The local `InboundContactIndex` does not track channel-lock or DNC state explicitly, so buckets
 * that depend on those concepts are returned as `null` with an explanatory note rather than guessed.
 * When there is no local dataset for the client, returns a safe `available: false` result.
 */
export async function previewClientChannelProfileImpact(input: {
  clientAccountId: string;
  subaccountIdGhl?: string | null;
  applyScope?: ClientChannelApplyScope | null;
}): Promise<ChannelProfileImpactPreview> {
  const clientAccountId = input.clientAccountId.trim();
  const sub = input.subaccountIdGhl?.trim();

  const emptyBuckets = (): ChannelProfileImpactPreview["buckets"] => ({
    newLeadsAffected: { count: null },
    activeLockedLeadsAffected: { count: null },
    activeUnlockedLeadsAffected: { count: null },
    eligibleForRecalculation: { count: null },
    requiresReview: { count: null },
    skippedChannelLocked: { count: null },
    skippedDncDeadOrBadNumber: { count: null },
  });

  try {
    const where: { clientAccountId: string; subaccountIdGhl?: string } = { clientAccountId };
    if (sub) where.subaccountIdGhl = sub;

    const total = await prisma.inboundContactIndex.count({ where });

    if (total === 0) {
      return {
        available: false,
        message: UNAVAILABLE_MESSAGE,
        applyScope: input.applyScope ?? null,
        dataSource: null,
        totalIndexedContacts: 0,
        buckets: emptyBuckets(),
        notes: [
          "No local contact index rows exist for this client yet.",
          "Counts will populate once inbound contact data is backfilled or webhook-synced.",
        ],
      };
    }

    const rows = await prisma.inboundContactIndex.findMany({
      where,
      select: {
        clientStatus: true,
        lifecycleStage: true,
        appointmentStatus: true,
        policyStatus: true,
        leadType: true,
      },
      take: 5000,
    });

    let activeUnlocked = 0;
    let requiresReview = 0;
    let deadOrBad = 0;
    let existingClients = 0;

    for (const r of rows) {
      if (looksDeadOrBad(r.lifecycleStage, r.policyStatus, r.appointmentStatus)) {
        deadOrBad += 1;
        continue;
      }
      if (r.clientStatus === "EXISTING_CLIENT") {
        existingClients += 1;
      }
      if (r.clientStatus === "UNKNOWN" || (!r.lifecycleStage && !r.leadType)) {
        requiresReview += 1;
      }
      // Channel-lock is not tracked locally; treat all non-dead leads as "unlocked" estimate.
      activeUnlocked += 1;
    }

    const notes = [
      "Channel-lock state is not tracked in the local contact index; locked counts are unverified (shown as —).",
      "Estimates exclude any leads not represented in the local index.",
    ];

    return {
      available: true,
      message:
        "Read-only estimate based on the local contact index. No leads are modified by this preview.",
      applyScope: input.applyScope ?? null,
      dataSource: "inbound_contact_index",
      totalIndexedContacts: total,
      buckets: {
        // New leads are forward-looking (future inbound), not represented in the historical index.
        newLeadsAffected: {
          count: null,
          note: "Applies to future inbound leads; not countable from the historical index.",
        },
        activeLockedLeadsAffected: {
          count: null,
          note: "Channel-lock state not tracked in local index.",
        },
        activeUnlockedLeadsAffected: { count: activeUnlocked },
        eligibleForRecalculation: {
          count: input.applyScope === "NEW_LEADS_ONLY" ? 0 : activeUnlocked,
          note:
            input.applyScope === "NEW_LEADS_ONLY"
              ? "Scope is new-leads-only; existing leads are not recalculated."
              : undefined,
        },
        requiresReview: { count: requiresReview },
        skippedChannelLocked: {
          count: null,
          note: "Channel-lock state not tracked in local index.",
        },
        skippedDncDeadOrBadNumber: { count: deadOrBad },
      },
      notes: [
        ...notes,
        `${existingClients} indexed contact(s) marked as existing clients.`,
      ],
    };
  } catch {
    return {
      available: false,
      message: UNAVAILABLE_MESSAGE,
      applyScope: input.applyScope ?? null,
      dataSource: null,
      totalIndexedContacts: 0,
      buckets: emptyBuckets(),
      notes: ["Impact preview could not be computed; the contact index may be unavailable."],
    };
  }
}
