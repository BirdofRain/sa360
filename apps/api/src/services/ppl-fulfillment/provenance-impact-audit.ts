import { Prisma, PrismaClient } from "@prisma/client";

import {
  PROVENANCE_IMPACT_STATEMENT_TIMEOUT_MS,
  buildProvenanceImpactQuery,
  provenanceCodeSql,
  campaignLabelAgreementSql,
} from "./provenance-impact-query.js";
import {
  ProvenanceImpactShapeError,
  assembleProvenanceImpactReport,
  responseContainsSecret,
  unavailableProvenanceImpact,
  type ProvenanceImpactReport,
  type ProvenanceImpactUnavailable,
} from "./provenance-impact-report.js";
import type { ProvenanceEligibilityInput } from "./provenance-eligibility.js";

export type ProvenanceImpactAuditResult = ProvenanceImpactReport | ProvenanceImpactUnavailable;

type AuditClient = PrismaClient | Prisma.TransactionClient;

export type ProvenanceImpactAuditOptions = {
  statementTimeoutMs?: number;
  /**
   * Test seam. Runs after the snapshot's first statement, on the caller's
   * connection, so a second connection can commit rows this snapshot must ignore.
   * The HTTP route does not pass it.
   */
  afterSnapshotOpened?: () => Promise<void>;
};

/**
 * There is no persisted verified-acquisition model and no authenticated lookup.
 * Returning anything other than null would let a string masquerade as evidence.
 */
export function lookupPersistedVerifiedAcquisitionEvidenceId(): null {
  return null;
}

function boundedTimeout(statementTimeoutMs: number | undefined): number {
  if (statementTimeoutMs == null) return PROVENANCE_IMPACT_STATEMENT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(statementTimeoutMs) ||
    statementTimeoutMs < 1 ||
    statementTimeoutMs > PROVENANCE_IMPACT_STATEMENT_TIMEOUT_MS
  ) {
    throw new ProvenanceImpactShapeError("invalid_statement_timeout");
  }
  return statementTimeoutMs;
}

function isStatementTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  if (code === "57014") return true;
  const message = error instanceof Error ? error.message : "";
  return /statement timeout|canceling statement/i.test(message);
}

export async function withProvenanceAuditSnapshot<T>(
  db: PrismaClient,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: ProvenanceImpactAuditOptions
): Promise<T> {
  if (typeof db.$transaction !== "function") {
    throw new ProvenanceImpactShapeError("snapshot_unavailable");
  }
  const timeoutMs = boundedTimeout(options?.statementTimeoutMs);
  return db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(timeoutMs)}, true)`;
      if (options?.afterSnapshotOpened) await options.afterSnapshotOpened();
      return run(tx);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 10_000,
      timeout: timeoutMs + 15_000,
    }
  );
}

export async function runProvenanceImpactAudit(
  db: PrismaClient,
  options?: ProvenanceImpactAuditOptions
): Promise<ProvenanceImpactAuditResult> {
  if (lookupPersistedVerifiedAcquisitionEvidenceId() !== null) {
    return unavailableProvenanceImpact("verified_acquisition_lookup_unexpected");
  }
  try {
    const timeoutMs = boundedTimeout(options?.statementTimeoutMs);
    const report = await withProvenanceAuditSnapshot(
      db,
      async (tx) => {
        const query = buildProvenanceImpactQuery();
        const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(query);
        if (rows.length !== 1) throw new ProvenanceImpactShapeError("incomplete_result");
        return assembleProvenanceImpactReport(rows[0], timeoutMs);
      },
      options
    );
    if (responseContainsSecret(JSON.stringify(report))) {
      return unavailableProvenanceImpact("unsafe_response");
    }
    return report;
  } catch (error) {
    if (error instanceof ProvenanceImpactShapeError) {
      const reason =
        error.message === "incomplete_result" || error.message === "missing_row"
          ? "incomplete_result"
          : "reconciliation_failed";
      return unavailableProvenanceImpact(reason);
    }
    if (isStatementTimeout(error)) return unavailableProvenanceImpact("statement_timeout");
    return unavailableProvenanceImpact("snapshot_failed");
  }
}

export async function evaluateProvenanceCodeInPostgres(
  db: AuditClient,
  input: ProvenanceEligibilityInput
): Promise<string> {
  const query = Prisma.sql`
    SELECT ${provenanceCodeSql({
      itemProvider: Prisma.sql`${input.itemSourceProvider ?? null}::text`,
      eventProvider: Prisma.sql`${input.eventSourceProvider ?? null}::text`,
      eventSystem: Prisma.sql`${input.eventSourceSystem ?? null}::text`,
      origin: Prisma.sql`${input.originClientAccountId ?? null}::text`,
      verifiedAcquisitionId: Prisma.sql`${input.verifiedAcquisitionEvidenceId ?? null}::text`,
    })} AS code
  `;
  const rows = await db.$queryRaw<Array<{ code: string }>>(query);
  const code = rows[0]?.code;
  if (!code) throw new Error("provenance_probe_missing");
  return code;
}

export async function evaluateCampaignAgreementInPostgres(
  db: AuditClient,
  input: {
    sourceCampaignName: string | null;
    normalizedCampaignName: string | null;
    rawLeadType: string | null;
  }
): Promise<string> {
  const column = Prisma.sql`NULLIF(BTRIM(${input.sourceCampaignName}::text), '')`;
  const normalized = Prisma.sql`NULLIF(BTRIM(${input.normalizedCampaignName}::text), '')`;
  const raw = Prisma.sql`NULLIF(BTRIM(${input.rawLeadType}::text), '')`;
  const rows = await db.$queryRaw<Array<{ agreement: string }>>(Prisma.sql`
    SELECT ${campaignLabelAgreementSql(column, normalized, raw)} AS agreement
  `);
  const agreement = rows[0]?.agreement;
  if (!agreement) throw new Error("label_probe_missing");
  return agreement;
}
