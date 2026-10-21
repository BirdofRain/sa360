import { Prisma } from "@prisma/client";

export {
  COMPANY_SHEETS_OPERATOR_ROUTING_AUTHORITY,
  COMPANY_SHEETS_PILOT_MATCH_TYPE,
  COMPANY_SHEETS_PILOT_RECORD_CLASS,
  COMPANY_SHEETS_PILOT_ROUTE_KEY,
  isCompanySheetsInternalPilotDecision,
  isCompanySheetsInternalPilotLead,
  isCompanySheetsInternalPilotLifecycle,
} from "@sa360/shared";

import {
  COMPANY_SHEETS_PILOT_RECORD_CLASS,
  COMPANY_SHEETS_PILOT_ROUTE_KEY,
} from "@sa360/shared";

/** Thrown when a consumer is asked to enqueue or allocate a synthetic pilot lead. */
export class CompanySheetsPilotIsolatedError extends Error {
  readonly code = "company_sheets_internal_pilot" as const;

  constructor() {
    super("company_sheets_internal_pilot");
    this.name = "CompanySheetsPilotIsolatedError";
  }
}

function jsonLacksPilotMarker(path: string[], value: string): Prisma.SourceLeadEventWhereInput {
  // Prisma's NOT { path, equals } drops rows whose key is absent and rows whose
  // JSON is null. Keep those, and keep a present key with any other value.
  // { path, equals: DbNull } matches a missing key on PostgreSQL.
  return {
    OR: [
      { enrichmentMetadataJson: { equals: Prisma.DbNull } },
      { enrichmentMetadataJson: { equals: Prisma.JsonNull } },
      { enrichmentMetadataJson: { path, equals: Prisma.DbNull } },
      { NOT: { enrichmentMetadataJson: { path, equals: value } } },
    ],
  };
}

/**
 * Null-safe exclusion for scans. A missing route key or enrichment stays eligible.
 * Either pilot marker removes the row.
 */
export function companySheetsInternalPilotLeadExclusion(): Prisma.SourceLeadEventWhereInput {
  return {
    AND: [
      {
        OR: [
          { sourceRouteKey: null },
          { sourceRouteKey: { not: COMPANY_SHEETS_PILOT_ROUTE_KEY } },
        ],
      },
      jsonLacksPilotMarker(["recordClass"], COMPANY_SHEETS_PILOT_RECORD_CLASS),
      jsonLacksPilotMarker(["intake"], COMPANY_SHEETS_PILOT_ROUTE_KEY),
    ],
  };
}
