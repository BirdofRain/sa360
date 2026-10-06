/**
 * Bounded item scope for aged ops-verify runs.
 *
 * Lot-scale verify/activate is the legacy default. An explicit item scope lets a
 * single order be served without collaterally verifying or activating the rest of
 * the lot. Kept free of Prisma/db imports so it stays unit-testable.
 */

/** Normalized bounded scope, or `null` for whole-lot behavior. */
export function resolveItemScope(inventoryItemIds: string[] | undefined): string[] | null {
  const ids = [...new Set((inventoryItemIds ?? []).map((id) => id.trim()).filter(Boolean))];
  return ids.length > 0 ? ids : null;
}

/**
 * Cursor-paged `id` filter that also honors an optional bounded scope. Both
 * clauses must land in the same `id` object: emitting them separately would make
 * one silently overwrite the other.
 */
export function scopedIdWhere(
  scope: string[] | null,
  cursor: string | undefined
): { id?: { in?: string[]; gt?: string } } {
  if (!scope && !cursor) return {};
  return {
    id: {
      ...(scope ? { in: scope } : {}),
      ...(cursor ? { gt: cursor } : {}),
    },
  };
}
