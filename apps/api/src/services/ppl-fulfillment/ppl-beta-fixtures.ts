import type { PrismaClient } from "@prisma/client";

import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import { nextLeadOrderNumber } from "../../repositories/lead-order.repository.js";

/** Localhost-only canonical beta buyer id (display name is documentation-only). */
export const PPL_BETA_BUYER_CLIENT_ID = "client_vanessa_powell_beta";
export const PPL_BETA_OTHER_BUYER_CLIENT_ID = "client_other_buyer_beta";
export const PPL_BETA_PROTECTED_SUPPLIER_ID = "supplier_protected_agent_beta";

export type SeededInventoryItem = {
  id: string;
  nicheKey: string;
  state: string;
  ageDays: number;
  phone: string;
  email: string;
  tag: string;
};

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function contactPayload(input: {
  first: string;
  last: string;
  phone: string;
  email: string;
  state: string;
  agentName?: string;
}) {
  return {
    contact: {
      first_name: input.first,
      last_name: input.last,
      phone_e164: input.phone,
      email: input.email,
      state: input.state,
    },
    lead_details: { consumer_age: 55 },
    ownership: input.agentName
      ? { assigned_agent_name: input.agentName }
      : undefined,
  };
}

/**
 * Idempotent localhost-only fixture seed for PPL aged-inventory beta rehearsal.
 * Uses synthetic PII only. Does not authorize by display name.
 */
export async function seedPplAgedBetaFixtures(db: PrismaClient): Promise<{
  buyerClientId: string;
  otherBuyerClientId: string;
  cleanItems: SeededInventoryItem[];
  priorDuplicatePhone: string;
  protectedItemId: string;
  replacementCandidateItemId: string;
  orderId: string;
  orderNumber: string;
}> {
  await db.clientAccount.upsert({
    where: { clientAccountId: PPL_BETA_BUYER_CLIENT_ID },
    create: {
      clientAccountId: PPL_BETA_BUYER_CLIENT_ID,
      clientDisplayName: "Vanessa Powell (beta fixture)",
      status: "active",
      portalEnabled: false,
      primaryNicheKeys: ["vet", "trucker"],
      notes: "Localhost-only PPL aged inventory beta buyer fixture",
    },
    update: {
      clientDisplayName: "Vanessa Powell (beta fixture)",
      status: "active",
    },
  });
  await db.clientAccount.upsert({
    where: { clientAccountId: PPL_BETA_OTHER_BUYER_CLIENT_ID },
    create: {
      clientAccountId: PPL_BETA_OTHER_BUYER_CLIENT_ID,
      clientDisplayName: "Other Buyer (beta fixture)",
      status: "active",
      portalEnabled: false,
      primaryNicheKeys: ["vet"],
    },
    update: { status: "active" },
  });

  await db.protectedAgentExclusion.upsert({
    where: {
      matchType_matchValue: {
        matchType: "supplier_account_id",
        matchValue: PPL_BETA_PROTECTED_SUPPLIER_ID,
      },
    },
    create: {
      matchType: "supplier_account_id",
      matchValue: PPL_BETA_PROTECTED_SUPPLIER_ID,
      active: true,
      note: "Localhost beta protected supplier",
    },
    update: { active: true },
  });

  // Clear prior rehearsal/test residue so re-seed restores a clean selectable pool.
  const betaItemIds = (
    await db.leadInventoryItem.findMany({
      where: { id: { startsWith: "ppl-beta-item-" } },
      select: { id: true },
    })
  ).map((row) => row.id);
  const betaEventIds = (
    await db.sourceLeadEvent.findMany({
      where: { id: { startsWith: "ppl-beta-evt-" } },
      select: { id: true },
    })
  ).map((row) => row.id);
  const betaAllocations = await db.leadAllocation.findMany({
    where: {
      OR: [
        ...(betaItemIds.length > 0 ? [{ leadInventoryItemId: { in: betaItemIds } }] : []),
        ...(betaEventIds.length > 0 ? [{ sourceLeadEventId: { in: betaEventIds } }] : []),
        {
          clientAccountId: {
            in: [PPL_BETA_BUYER_CLIENT_ID, PPL_BETA_OTHER_BUYER_CLIENT_ID],
          },
        },
      ],
    },
    select: { id: true, leadOrderId: true },
  });
  const betaAllocationIds = betaAllocations.map((row) => row.id);
  const betaOrderIds = [...new Set(betaAllocations.map((row) => row.leadOrderId))];

  if (betaAllocationIds.length > 0 || betaOrderIds.length > 0) {
    await db.leadReplacementRequest.deleteMany({
      where: {
        OR: [
          ...(betaAllocationIds.length > 0
            ? [
                { originalAllocationId: { in: betaAllocationIds } },
                { replacementAllocationId: { in: betaAllocationIds } },
              ]
            : []),
          ...(betaOrderIds.length > 0 ? [{ leadOrderId: { in: betaOrderIds } }] : []),
          {
            clientAccountId: {
              in: [PPL_BETA_BUYER_CLIENT_ID, PPL_BETA_OTHER_BUYER_CLIENT_ID],
            },
          },
        ],
      },
    });
  }
  await db.leadDeliveryExportPackage.deleteMany({
    where: {
      clientAccountId: {
        in: [PPL_BETA_BUYER_CLIENT_ID, PPL_BETA_OTHER_BUYER_CLIENT_ID],
      },
    },
  });
  await db.buyerDeliveredIdentity.deleteMany({
    where: {
      clientAccountId: {
        in: [PPL_BETA_BUYER_CLIENT_ID, PPL_BETA_OTHER_BUYER_CLIENT_ID],
      },
    },
  });
  if (betaAllocationIds.length > 0) {
    await db.leadAllocation.deleteMany({ where: { id: { in: betaAllocationIds } } });
  }

  const lotClean = await db.inventoryLot.upsert({
    where: { lotKey: "ppl-beta-clean-lot" },
    create: {
      lotKey: "ppl-beta-clean-lot",
      displayName: "PPL beta clean aged lot",
      sourceProvider: "manual_import",
      sourceLane: "aged_csv_beta",
      nicheKey: "vet",
      inventoryClass: "aged",
      exclusivityMode: "exclusive",
      status: "active",
      supplierAccountId: "supplier_clean_beta",
      activatedAt: new Date(),
    },
    update: { status: "active" },
  });

  const lotProtected = await db.inventoryLot.upsert({
    where: { lotKey: "ppl-beta-protected-lot" },
    create: {
      lotKey: "ppl-beta-protected-lot",
      displayName: "PPL beta protected lot",
      sourceProvider: "manual_import",
      sourceLane: "aged_csv_beta",
      nicheKey: "vet",
      inventoryClass: "aged",
      exclusivityMode: "exclusive",
      status: "active",
      supplierAccountId: PPL_BETA_PROTECTED_SUPPLIER_ID,
      activatedAt: new Date(),
    },
    update: {
      status: "active",
      supplierAccountId: PPL_BETA_PROTECTED_SUPPLIER_ID,
    },
  });

  const specs: Array<{
    tag: string;
    nicheKey: string;
    state: string;
    ageDays: number;
    phone: string;
    email: string;
    lotId: string;
    first: string;
    last: string;
    agentName?: string;
  }> = [];

  const states = ["NC", "TX", "NJ", "CA"] as const;
  const niches = ["vet", "trucker"] as const;
  const ages = [45, 120, 200, 400] as const; // one per commerce bucket
  let n = 0;
  for (const nicheKey of niches) {
    for (const state of states) {
      for (const ageDays of ages) {
        n += 1;
        specs.push({
          tag: `clean-${nicheKey}-${state}-${ageDays}-${n}`,
          nicheKey,
          state,
          ageDays,
          phone: `+1555100${String(1000 + n).slice(-4)}`,
          email: `beta.clean.${n}@example.test`,
          lotId: lotClean.id,
          first: `Clean${n}`,
          last: "Lead",
        });
      }
    }
  }

  // Prior same-buyer duplicate identity (committed history row)
  const priorPhone = "+15559990001";
  const priorEmail = "prior.same.buyer@example.test";
  specs.push({
    tag: "prior-same-buyer-dupe-source",
    nicheKey: "vet",
    state: "NC",
    ageDays: 60,
    phone: priorPhone,
    email: priorEmail,
    lotId: lotClean.id,
    first: "Prior",
    last: "Duplicate",
  });

  // Available inventory sharing prior same-buyer identity (must be excluded)
  specs.push({
    tag: "same-buyer-prior-available",
    nicheKey: "vet",
    state: "NC",
    ageDays: 65,
    phone: priorPhone,
    email: priorEmail,
    lotId: lotClean.id,
    first: "SameBuyer",
    last: "AvailableDupe",
  });

  // Different-buyer history identity
  specs.push({
    tag: "other-buyer-history",
    nicheKey: "vet",
    state: "TX",
    ageDays: 70,
    phone: "+15559990002",
    email: "other.buyer.history@example.test",
    lotId: lotClean.id,
    first: "Other",
    last: "History",
  });

  // Protected-agent inventory
  specs.push({
    tag: "protected-agent",
    nicheKey: "vet",
    state: "NJ",
    ageDays: 80,
    phone: "+15559990003",
    email: "protected.agent@example.test",
    lotId: lotProtected.id,
    first: "Protected",
    last: "Agent",
    agentName: "Alex Agent",
  });

  // Ambiguous / invalid (no phone/email) — should be unusable for buyer identity
  specs.push({
    tag: "invalid-identity",
    nicheKey: "vet",
    state: "CA",
    ageDays: 90,
    phone: "",
    email: "",
    lotId: lotClean.id,
    first: "Invalid",
    last: "Identity",
  });

  // Current-batch duplicate pair (same identity, both available)
  specs.push({
    tag: "batch-dupe-a",
    nicheKey: "vet",
    state: "TX",
    ageDays: 50,
    phone: "+15559990077",
    email: "batch.dupe@example.test",
    lotId: lotClean.id,
    first: "Batch",
    last: "DupeA",
  });
  specs.push({
    tag: "batch-dupe-b",
    nicheKey: "vet",
    state: "TX",
    ageDays: 51,
    phone: "+15559990077",
    email: "batch.dupe@example.test",
    lotId: lotClean.id,
    first: "Batch",
    last: "DupeB",
  });

  // Extra replacement candidate
  specs.push({
    tag: "replacement-candidate",
    nicheKey: "vet",
    state: "NC",
    ageDays: 55,
    phone: "+15559990099",
    email: "replacement.candidate@example.test",
    lotId: lotClean.id,
    first: "Replace",
    last: "Candidate",
  });

  const cleanItems: SeededInventoryItem[] = [];
  let protectedItemId = "";
  let replacementCandidateItemId = "";
  let priorItemId = "";
  let priorEventId = "";
  let otherHistoryItemId = "";
  let otherHistoryEventId = "";

  for (const spec of specs) {
    const eventId = `ppl-beta-evt-${spec.tag}`;
    const itemId = `ppl-beta-item-${spec.tag}`;
    const payload = contactPayload({
      first: spec.first,
      last: spec.last,
      phone: spec.phone,
      email: spec.email,
      state: spec.state,
      agentName: spec.agentName,
    });

    await db.sourceLeadEvent.upsert({
      where: { id: eventId },
      create: {
        id: eventId,
        sourceProvider: "manual_import",
        sourceSystem: "leadcapture_io_legacy",
        sourceType: "manual_entry",
        sourceLeadId: `src-${spec.tag}`,
        status: "approved",
        rawPayloadJson: payload,
        normalizedPayloadJson: payload,
        enrichmentMetadataJson: spec.agentName
          ? { sourceAttributes: { assigned_agent_name: spec.agentName } }
          : {},
        receivedAt: daysAgo(spec.ageDays),
        normalizedAt: daysAgo(spec.ageDays),
        approvedAt: daysAgo(1),
      },
      update: {
        normalizedPayloadJson: payload,
        enrichmentMetadataJson: spec.agentName
          ? { sourceAttributes: { assigned_agent_name: spec.agentName } }
          : {},
        status: "approved",
      },
    });

    await db.leadInventoryItem.upsert({
      where: { id: itemId },
      create: {
        id: itemId,
        inventoryLotId: spec.lotId,
        sourceLeadEventId: eventId,
        generatedAt: daysAgo(spec.ageDays),
        normalizedState: spec.state,
        nicheKey: spec.nicheKey,
        sourceProvider: "manual_import",
        sourceLane: "aged_csv_beta",
        inventoryClass: "aged",
        exclusivityMode: "exclusive",
        status: "available",
        availableAt: new Date(),
      },
      update: {
        status: "available",
        reservedAt: null,
        committedAt: null,
        generatedAt: daysAgo(spec.ageDays),
        normalizedState: spec.state,
        nicheKey: spec.nicheKey,
        inventoryLotId: spec.lotId,
      },
    });

    if (spec.tag.startsWith("clean-")) {
      cleanItems.push({
        id: itemId,
        nicheKey: spec.nicheKey,
        state: spec.state,
        ageDays: spec.ageDays,
        phone: spec.phone,
        email: spec.email,
        tag: spec.tag,
      });
    }
    if (spec.tag === "protected-agent") protectedItemId = itemId;
    if (spec.tag === "replacement-candidate") replacementCandidateItemId = itemId;
    if (spec.tag === "prior-same-buyer-dupe-source") {
      priorItemId = itemId;
      priorEventId = eventId;
    }
    if (spec.tag === "other-buyer-history") {
      otherHistoryItemId = itemId;
      otherHistoryEventId = eventId;
    }
  }

  // Record prior deliveries (history) without touching clean available inventory.
  await db.buyerDeliveredIdentity.deleteMany({
    where: {
      clientAccountId: {
        in: [PPL_BETA_BUYER_CLIENT_ID, PPL_BETA_OTHER_BUYER_CLIENT_ID],
      },
      sourceLeadEventId: { in: [priorEventId, otherHistoryEventId] },
    },
  });
  await db.buyerDeliveredIdentity.createMany({
    data: [
      {
        clientAccountId: PPL_BETA_BUYER_CLIENT_ID,
        phoneFingerprint: fingerprintIdentityValue("phone", priorPhone),
        emailFingerprint: fingerprintIdentityValue("email", priorEmail),
        sourceLeadEventId: priorEventId,
        leadAllocationId: "ppl-beta-prior-alloc-placeholder",
        leadInventoryItemId: priorItemId,
      },
      {
        clientAccountId: PPL_BETA_OTHER_BUYER_CLIENT_ID,
        phoneFingerprint: fingerprintIdentityValue("phone", "+15559990002"),
        emailFingerprint: fingerprintIdentityValue(
          "email",
          "other.buyer.history@example.test"
        ),
        sourceLeadEventId: otherHistoryEventId,
        leadAllocationId: "ppl-beta-other-alloc-placeholder",
        leadInventoryItemId: otherHistoryItemId,
      },
    ],
    skipDuplicates: true,
  });

  // Mark prior/history fixture items as committed so they are not selectable.
  await db.leadInventoryItem.updateMany({
    where: { id: { in: [priorItemId, otherHistoryItemId].filter(Boolean) } },
    data: { status: "committed", committedAt: new Date() },
  });

  const orderNumber = await nextLeadOrderNumber(db);
  const order = await db.leadOrder.create({
    data: {
      orderNumber,
      clientAccountId: PPL_BETA_BUYER_CLIENT_ID,
      clientDisplayName: "Vanessa Powell (beta fixture)",
      status: "active",
      nicheKey: "vet",
      statesJson: ["NC", "TX", "NJ", "CA"],
      leadVolume: 3,
      deliveryCadence: "manual_ops_workbench",
      campaignType: "ppl_aged_beta_rehearsal",
      crmPackage: "simulation_only",
      createdByRole: "admin",
      submittedAt: new Date(),
      activatedAt: new Date(),
      orderKind: "pay_per_lead",
      fulfillmentMode: "pooled_matching",
      requestedQuantity: 3,
      exclusivityRequired: false,
      notes: "Localhost PPL aged beta rehearsal order",
    },
  });

  return {
    buyerClientId: PPL_BETA_BUYER_CLIENT_ID,
    otherBuyerClientId: PPL_BETA_OTHER_BUYER_CLIENT_ID,
    cleanItems,
    priorDuplicatePhone: priorPhone,
    protectedItemId,
    replacementCandidateItemId,
    orderId: order.id,
    orderNumber: order.orderNumber,
  };
}

export function assertLocalhostDatabaseUrl(url: string | undefined): string {
  const value = url?.trim() ?? "";
  if (!value) throw new Error("DATABASE_URL_required");
  let host = "";
  try {
    host = new URL(value).hostname;
  } catch {
    throw new Error("DATABASE_URL_invalid");
  }
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`DATABASE_URL_remote_blocked:${host}`);
  }
  return value;
}
