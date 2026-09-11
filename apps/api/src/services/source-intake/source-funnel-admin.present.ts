import type { SourceFunnel } from "@prisma/client";

export type SourceFunnelAdminDto = {
  id: string;
  provider: SourceFunnel["provider"];
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  pageSlug: string | null;
  observedFunnelName: string | null;
  nicheKey: string | null;
  associationStatus: SourceFunnel["associationStatus"];
  suggestedClientAccountId: string | null;
  originClientAccountId: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function presentSourceFunnelAdmin(row: SourceFunnel): SourceFunnelAdminDto {
  return {
    id: row.id,
    provider: row.provider,
    providerFunnelId: row.providerFunnelId,
    parentUrlKey: row.parentUrlKey,
    pageSlug: row.pageSlug,
    observedFunnelName: row.observedFunnelName,
    nicheKey: row.nicheKey,
    associationStatus: row.associationStatus,
    suggestedClientAccountId: row.suggestedClientAccountId,
    originClientAccountId: row.originClientAccountId,
    firstSeenAt: iso(row.firstSeenAt),
    lastSeenAt: iso(row.lastSeenAt),
  };
}

function statusRank(status: SourceFunnel["associationStatus"]): number {
  if (status === "confirmed") return 0;
  if (status === "suggested") return 1;
  return 2;
}

/**
 * Operator list order:
 * 1. confirmed before suggested
 * 2. observed (firstSeenAt set) before never-observed / pre-registered
 * 3. most recently seen first
 * 4. deterministic id
 */
export function compareSourceFunnelsForClientList(a: SourceFunnel, b: SourceFunnel): number {
  const status = statusRank(a.associationStatus) - statusRank(b.associationStatus);
  if (status !== 0) return status;
  const observedA = a.firstSeenAt ? 0 : 1;
  const observedB = b.firstSeenAt ? 0 : 1;
  if (observedA !== observedB) return observedA - observedB;
  const lastA = a.lastSeenAt?.getTime() ?? 0;
  const lastB = b.lastSeenAt?.getTime() ?? 0;
  if (lastA !== lastB) return lastB - lastA;
  return a.id.localeCompare(b.id);
}

export function sortSourceFunnelsForClientList(rows: SourceFunnel[]): SourceFunnel[] {
  return [...rows].sort(compareSourceFunnelsForClientList);
}

export type SourceFunnelOriginConflictDto = {
  ok: false;
  error: string;
  code: "confirm_requires_explicit_reassign";
  sourceFunnelId: string;
  parentUrlKey: string | null;
  pageSlug: string | null;
  currentOriginClientAccountId: string;
  currentOriginClientDisplayName: string | null;
  requestedOriginClientAccountId: string;
  item: SourceFunnelAdminDto;
};

export function presentSourceFunnelOriginConflict(input: {
  sourceFunnel: SourceFunnel;
  currentOriginClientAccountId: string;
  currentOriginClientDisplayName: string | null;
  requestedOriginClientAccountId: string;
}): SourceFunnelOriginConflictDto {
  return {
    ok: false,
    error: "This source is already associated with another client.",
    code: "confirm_requires_explicit_reassign",
    sourceFunnelId: input.sourceFunnel.id,
    parentUrlKey: input.sourceFunnel.parentUrlKey,
    pageSlug: input.sourceFunnel.pageSlug,
    currentOriginClientAccountId: input.currentOriginClientAccountId,
    currentOriginClientDisplayName: input.currentOriginClientDisplayName,
    requestedOriginClientAccountId: input.requestedOriginClientAccountId,
    item: presentSourceFunnelAdmin(input.sourceFunnel),
  };
}
