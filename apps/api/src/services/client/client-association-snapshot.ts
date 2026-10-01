import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Current Facebook capture association snapshots.
 *
 * `clientAccountIdResolved` is the live client association. The two JSON fields
 * below are the current snapshot of that same association. `associationAudit`
 * is historical and is never rewritten here.
 *
 * A snapshot that still names a client after that client's resolved association
 * has moved or been removed is inconsistent. Rekey migrates snapshots only on
 * events whose resolved id is the source client and whose current field equals
 * that source id, so the snapshot stays aligned with the resolved id. Snapshots
 * that name the source client while `clientAccountIdResolved` does not are left
 * unchanged and block rekey and deletion: deleting the client would keep a
 * current snapshot that no longer matches the stored association.
 */

export const ENRICHMENT_ASSOCIATION_CLIENT_FIELD =
  "enrichmentMetadataJson.association.clientAccountId" as const;
export const NORMALIZED_ASSOCIATION_CLIENT_FIELD =
  "normalizedPayloadJson.association.client_account_id" as const;

export type AssociationSnapshotField =
  | typeof ENRICHMENT_ASSOCIATION_CLIENT_FIELD
  | typeof NORMALIZED_ASSOCIATION_CLIENT_FIELD;

export type InconsistentAssociationSnapshotRow = {
  id: string;
  clientAccountIdResolved: string | null;
  referencedFields: AssociationSnapshotField[];
};

type SnapshotDb = PrismaClient | Prisma.TransactionClient;

type SnapshotQueryRow = {
  id: string;
  clientAccountIdResolved: string | null;
  enrichmentClientAccountId: string | null;
  normalizedClientAccountId: string | null;
};

export function summarizeInconsistentAssociationSnapshots(
  clientAccountId: string,
  rows: SnapshotQueryRow[]
): {
  enrichmentReferences: number;
  normalizedReferences: number;
  rows: InconsistentAssociationSnapshotRow[];
} {
  const summarized: InconsistentAssociationSnapshotRow[] = [];
  let enrichmentReferences = 0;
  let normalizedReferences = 0;
  for (const row of rows) {
    if (row.clientAccountIdResolved === clientAccountId) continue;
    const referencedFields: AssociationSnapshotField[] = [];
    if (row.enrichmentClientAccountId === clientAccountId) {
      enrichmentReferences += 1;
      referencedFields.push(ENRICHMENT_ASSOCIATION_CLIENT_FIELD);
    }
    if (row.normalizedClientAccountId === clientAccountId) {
      normalizedReferences += 1;
      referencedFields.push(NORMALIZED_ASSOCIATION_CLIENT_FIELD);
    }
    if (referencedFields.length === 0) continue;
    summarized.push({
      id: row.id,
      clientAccountIdResolved: row.clientAccountIdResolved,
      referencedFields,
    });
  }
  return { enrichmentReferences, normalizedReferences, rows: summarized };
}

export async function listInconsistentCurrentAssociationSnapshots(
  clientAccountId: string,
  db: SnapshotDb
): Promise<{
  enrichmentReferences: number;
  normalizedReferences: number;
  rows: InconsistentAssociationSnapshotRow[];
}> {
  const id = clientAccountId.trim();
  const rows = await db.$queryRaw<SnapshotQueryRow[]>`
    SELECT
      "id",
      "clientAccountIdResolved",
      "enrichmentMetadataJson" #>> '{association,clientAccountId}' AS "enrichmentClientAccountId",
      "normalizedPayloadJson" #>> '{association,client_account_id}' AS "normalizedClientAccountId"
    FROM "SourceLeadEvent"
    WHERE (
      "enrichmentMetadataJson" #>> '{association,clientAccountId}' = ${id}
      OR "normalizedPayloadJson" #>> '{association,client_account_id}' = ${id}
    )
      AND "clientAccountIdResolved" IS DISTINCT FROM ${id}
    ORDER BY "id" ASC
  `;
  return summarizeInconsistentAssociationSnapshots(id, rows);
}

export async function countEnrichmentAssociationSnapshots(
  sourceId: string,
  db: SnapshotDb
): Promise<number> {
  const rows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS "count"
    FROM "SourceLeadEvent"
    WHERE "clientAccountIdResolved" = ${sourceId}
      AND "enrichmentMetadataJson" #>> '{association,clientAccountId}' = ${sourceId}
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function countNormalizedAssociationSnapshots(
  sourceId: string,
  db: SnapshotDb
): Promise<number> {
  const rows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS "count"
    FROM "SourceLeadEvent"
    WHERE "clientAccountIdResolved" = ${sourceId}
      AND "normalizedPayloadJson" #>> '{association,client_account_id}' = ${sourceId}
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function migrateEnrichmentAssociationSnapshots(
  sourceId: string,
  targetId: string,
  db: SnapshotDb
): Promise<number> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE "SourceLeadEvent"
    SET "enrichmentMetadataJson" = jsonb_set(
      "enrichmentMetadataJson",
      '{association,clientAccountId}',
      to_jsonb(CAST(${targetId} AS text)),
      false
    )
    WHERE "clientAccountIdResolved" = ${sourceId}
      AND "enrichmentMetadataJson" #>> '{association,clientAccountId}' = ${sourceId}
    RETURNING "id"
  `;
  return rows.length;
}

export async function migrateNormalizedAssociationSnapshots(
  sourceId: string,
  targetId: string,
  db: SnapshotDb
): Promise<number> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE "SourceLeadEvent"
    SET "normalizedPayloadJson" = jsonb_set(
      "normalizedPayloadJson",
      '{association,client_account_id}',
      to_jsonb(CAST(${targetId} AS text)),
      false
    )
    WHERE "clientAccountIdResolved" = ${sourceId}
      AND "normalizedPayloadJson" #>> '{association,client_account_id}' = ${sourceId}
    RETURNING "id"
  `;
  return rows.length;
}
