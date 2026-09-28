import type { Prisma, PrismaClient } from "@prisma/client";

import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";

export type CampaignIdentityFingerprints = {
  phoneE164: string | null;
  email: string | null;
  phoneFingerprint: string | null;
  emailFingerprint: string | null;
};

export type CampaignInventoryIdentityHit = {
  inventoryItemId: string;
  sourceLeadEventId: string;
  match:
    | "same_event"
    | "source_lead_id"
    | "phone_fingerprint"
    | "email_fingerprint"
    | "historical_json_compat";
};

export type CampaignIdentityLookupDiagnostics = {
  queryCount: number;
  queries: string[];
  jsonCorpusScan: false;
  unboundedFindMany: false;
};

/** Stored inventoryTracking outcome for each identity match. Shared with the tracker. */
export const CAMPAIGN_IDENTITY_MATCH_OUTCOME = {
  same_event: "reused_same_event",
  source_lead_id: "reused_source_lead_id",
  phone_fingerprint: "reused_phone",
  email_fingerprint: "reused_email",
  historical_json_compat: "reused_historical",
} as const;

type DbClient = PrismaClient | Prisma.TransactionClient;

export function buildCampaignIdentityFingerprints(
  normalizedPayloadJson: unknown
): CampaignIdentityFingerprints {
  const identity = readNormalizedLeadIdentity(normalizedPayloadJson);
  const phoneE164 = identity?.phoneE164 ?? null;
  const email = identity?.email ? identity.email.trim().toLowerCase() : null;
  return {
    phoneE164,
    email,
    phoneFingerprint: phoneE164 ? fingerprintIdentityValue("phone", phoneE164) : null,
    emailFingerprint: email ? fingerprintIdentityValue("email", email) : null,
  };
}

/**
 * Indexed consumer-identity lookup for one webhook.
 *
 * Query order (each is a point lookup / LIMIT 1):
 * 1. LeadInventoryItem.sourceLeadEventId (unique)
 * 2. SourceLeadEvent (sourceProvider, sourceSystem, sourceLeadId) + inventory
 * 3. LeadInventoryItem.phoneFingerprint
 * 4. LeadInventoryItem.emailFingerprint
 * 5. Bounded historical JSON compatibility (expression-indexed, LIMIT 1)
 *    only when fingerprint columns miss.
 *
 * Never: findMany without take, never materializes the inventory corpus,
 * never uses BuyerDeliveredIdentity.
 */
export async function findExistingCampaignInventoryIdentity(
  input: {
    sourceLeadEventId: string;
    sourceProvider: string;
    sourceSystem: string;
    sourceLeadId: string | null;
    fingerprints: CampaignIdentityFingerprints;
  },
  db: DbClient
): Promise<{
  hit: CampaignInventoryIdentityHit | null;
  diagnostics: CampaignIdentityLookupDiagnostics;
}> {
  const queries: string[] = [];
  let queryCount = 0;

  const record = (name: string) => {
    queryCount += 1;
    queries.push(name);
  };

  record("leadInventoryItem.findUnique(sourceLeadEventId)");
  const byEvent = await db.leadInventoryItem.findUnique({
    where: { sourceLeadEventId: input.sourceLeadEventId },
    select: { id: true, sourceLeadEventId: true },
  });
  if (byEvent) {
    return {
      hit: {
        inventoryItemId: byEvent.id,
        sourceLeadEventId: byEvent.sourceLeadEventId,
        match: "same_event",
      },
      diagnostics: {
        queryCount,
        queries,
        jsonCorpusScan: false,
        unboundedFindMany: false,
      },
    };
  }

  if (input.sourceLeadId?.trim()) {
    record("sourceLeadEvent.findFirst(provider,system,sourceLeadId) take=1");
    const bySourceId = await db.sourceLeadEvent.findFirst({
      where: {
        sourceProvider: input.sourceProvider as never,
        sourceSystem: input.sourceSystem as never,
        sourceLeadId: input.sourceLeadId.trim(),
        leadInventoryItem: { isNot: null },
      },
      select: {
        id: true,
        leadInventoryItem: { select: { id: true } },
      },
      orderBy: { receivedAt: "asc" },
    });
    if (bySourceId?.leadInventoryItem) {
      return {
        hit: {
          inventoryItemId: bySourceId.leadInventoryItem.id,
          sourceLeadEventId: bySourceId.id,
          match: "source_lead_id",
        },
        diagnostics: {
          queryCount,
          queries,
          jsonCorpusScan: false,
          unboundedFindMany: false,
        },
      };
    }
  }

  if (input.fingerprints.phoneFingerprint) {
    record("leadInventoryItem.findFirst(phoneFingerprint) take=1");
    const byPhone = await db.leadInventoryItem.findFirst({
      where: { phoneFingerprint: input.fingerprints.phoneFingerprint },
      select: { id: true, sourceLeadEventId: true },
      orderBy: { createdAt: "asc" },
    });
    if (byPhone) {
      return {
        hit: {
          inventoryItemId: byPhone.id,
          sourceLeadEventId: byPhone.sourceLeadEventId,
          match: "phone_fingerprint",
        },
        diagnostics: {
          queryCount,
          queries,
          jsonCorpusScan: false,
          unboundedFindMany: false,
        },
      };
    }
  }

  if (input.fingerprints.emailFingerprint) {
    record("leadInventoryItem.findFirst(emailFingerprint) take=1");
    const byEmail = await db.leadInventoryItem.findFirst({
      where: { emailFingerprint: input.fingerprints.emailFingerprint },
      select: { id: true, sourceLeadEventId: true },
      orderBy: { createdAt: "asc" },
    });
    if (byEmail) {
      return {
        hit: {
          inventoryItemId: byEmail.id,
          sourceLeadEventId: byEmail.sourceLeadEventId,
          match: "email_fingerprint",
        },
        diagnostics: {
          queryCount,
          queries,
          jsonCorpusScan: false,
          unboundedFindMany: false,
        },
      };
    }
  }

  const compat = await findHistoricalInventoryByIndexedJsonPaths(input.fingerprints, db, record);
  return {
    hit: compat,
    diagnostics: {
      queryCount,
      queries,
      jsonCorpusScan: false,
      unboundedFindMany: false,
    },
  };
}

/**
 * Bounded compatibility for historical inventory that still lacks fingerprint columns.
 * Uses expression-indexed JSON paths + LIMIT 1. Not a corpus-wide scan.
 */
async function findHistoricalInventoryByIndexedJsonPaths(
  fingerprints: CampaignIdentityFingerprints,
  db: DbClient,
  record: (name: string) => void
): Promise<CampaignInventoryIdentityHit | null> {
  if (fingerprints.phoneE164) {
    record("historical_json_compat.phone LIMIT 1");
    const rows = await db.$queryRaw<Array<{ id: string; sourceLeadEventId: string }>>`
      SELECT i.id, i."sourceLeadEventId"
      FROM "LeadInventoryItem" i
      INNER JOIN "SourceLeadEvent" e ON e.id = i."sourceLeadEventId"
      WHERE i."phoneFingerprint" IS NULL
        AND (
          e."normalizedPayloadJson" #>> '{phone_e164}' = ${fingerprints.phoneE164}
          OR e."normalizedPayloadJson" #>> '{contact,phone_e164}' = ${fingerprints.phoneE164}
        )
      ORDER BY i."createdAt" ASC
      LIMIT 1
    `;
    const hit = rows[0];
    if (hit) {
      return {
        inventoryItemId: hit.id,
        sourceLeadEventId: hit.sourceLeadEventId,
        match: "historical_json_compat",
      };
    }
  }

  if (fingerprints.email) {
    record("historical_json_compat.email LIMIT 1");
    const rows = await db.$queryRaw<Array<{ id: string; sourceLeadEventId: string }>>`
      SELECT i.id, i."sourceLeadEventId"
      FROM "LeadInventoryItem" i
      INNER JOIN "SourceLeadEvent" e ON e.id = i."sourceLeadEventId"
      WHERE i."emailFingerprint" IS NULL
        AND (
          lower(e."normalizedPayloadJson" #>> '{email}') = ${fingerprints.email}
          OR lower(e."normalizedPayloadJson" #>> '{contact,email}') = ${fingerprints.email}
        )
      ORDER BY i."createdAt" ASC
      LIMIT 1
    `;
    const hit = rows[0];
    if (hit) {
      return {
        inventoryItemId: hit.id,
        sourceLeadEventId: hit.sourceLeadEventId,
        match: "historical_json_compat",
      };
    }
  }

  return null;
}

/**
 * Read-only confirmation that a historical JSON match still belongs to this item.
 * Tracking copies the event fingerprint onto the item, so a later phone/email lookup
 * can hide the original historical match. The JSON paths are the same ones used above.
 * The predicate is the inventory primary key, not a corpus scan.
 */
export async function historicalInventoryItemStillMatches(
  input: {
    inventoryItemId: string;
    channel: "phone_fingerprint" | "email_fingerprint";
    fingerprints: CampaignIdentityFingerprints;
  },
  db: DbClient
): Promise<boolean> {
  if (input.channel === "phone_fingerprint") {
    if (!input.fingerprints.phoneE164 || !input.fingerprints.phoneFingerprint) return false;
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT i.id
      FROM "LeadInventoryItem" i
      INNER JOIN "SourceLeadEvent" e ON e.id = i."sourceLeadEventId"
      WHERE i.id = ${input.inventoryItemId}
        AND (
          i."phoneFingerprint" IS NULL
          OR i."phoneFingerprint" = ${input.fingerprints.phoneFingerprint}
        )
        AND (
          e."normalizedPayloadJson" #>> '{phone_e164}' = ${input.fingerprints.phoneE164}
          OR e."normalizedPayloadJson" #>> '{contact,phone_e164}' = ${input.fingerprints.phoneE164}
        )
      LIMIT 1
    `;
    return rows[0]?.id === input.inventoryItemId;
  }

  if (!input.fingerprints.email || !input.fingerprints.emailFingerprint) return false;
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT i.id
    FROM "LeadInventoryItem" i
    INNER JOIN "SourceLeadEvent" e ON e.id = i."sourceLeadEventId"
    WHERE i.id = ${input.inventoryItemId}
      AND (
        i."emailFingerprint" IS NULL
        OR i."emailFingerprint" = ${input.fingerprints.emailFingerprint}
      )
      AND (
        lower(e."normalizedPayloadJson" #>> '{email}') = ${input.fingerprints.email}
        OR lower(e."normalizedPayloadJson" #>> '{contact,email}') = ${input.fingerprints.email}
      )
    LIMIT 1
  `;
  return rows[0]?.id === input.inventoryItemId;
}

/**
 * Read-only check that this inventory row still carries the event fingerprint.
 * Returns no fingerprint value. A null column is unavailable, not a match.
 */
export async function storedFingerprintRelationship(
  input: {
    inventoryItemId: string;
    channel: "phone_fingerprint" | "email_fingerprint";
    fingerprint: string | null;
  },
  db: DbClient
): Promise<"match" | "mismatch" | "unavailable"> {
  if (!input.fingerprint) return "unavailable";
  const rows =
    input.channel === "phone_fingerprint"
      ? await db.$queryRaw<Array<{ id: string; present: boolean; matches: boolean | null }>>`
          SELECT i.id,
            i."phoneFingerprint" IS NOT NULL AS present,
            i."phoneFingerprint" = ${input.fingerprint} AS matches
          FROM "LeadInventoryItem" i
          WHERE i.id = ${input.inventoryItemId}
          LIMIT 1
        `
      : await db.$queryRaw<Array<{ id: string; present: boolean; matches: boolean | null }>>`
          SELECT i.id,
            i."emailFingerprint" IS NOT NULL AS present,
            i."emailFingerprint" = ${input.fingerprint} AS matches
          FROM "LeadInventoryItem" i
          WHERE i.id = ${input.inventoryItemId}
          LIMIT 1
        `;
  const row = rows[0];
  if (!row || row.id !== input.inventoryItemId || row.present !== true) return "unavailable";
  return row.matches === true ? "match" : "mismatch";
}
