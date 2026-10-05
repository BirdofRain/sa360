import { Prisma } from "@prisma/client";
import {
  canonicalizeCommerceNicheKey,
  commerceNicheMatchKeys,
  commerceNichesEquivalent,
} from "@sa360/shared";

export { commerceNichesEquivalent };

type InsensitiveNicheEquals = {
  nicheKey: { equals: string; mode: "insensitive" };
};

/**
 * Prisma filter for aged commerce matching.
 * Supported niches expand to every explicit alias (case-insensitive).
 * Unknown niches stay a single insensitive equals so probe keys do not widen.
 */
export function prismaCommerceNicheWhere(nicheKey: string): InsensitiveNicheEquals | { OR: InsensitiveNicheEquals[] } {
  const keys = commerceNicheMatchKeys(nicheKey);
  const clauses = keys.map(
    (key): InsensitiveNicheEquals => ({
      nicheKey: { equals: key, mode: "insensitive" },
    })
  );
  if (clauses.length <= 1) {
    return (
      clauses[0] ?? {
        nicheKey: { equals: nicheKey.trim(), mode: "insensitive" },
      }
    );
  }
  return { OR: clauses };
}

/**
 * SQL predicate for facet / snapshot filters.
 * Unknown niches stay exact so unspecified and probe keys are not expanded.
 */
export function commerceNicheSqlPredicate(column: Prisma.Sql, nicheKey: string): Prisma.Sql {
  const canonical = canonicalizeCommerceNicheKey(nicheKey);
  if (!canonical) {
    return Prisma.sql`${column} = ${nicheKey}`;
  }
  const keys = [...commerceNicheMatchKeys(nicheKey)];
  return Prisma.sql`LOWER(${column}) IN (${Prisma.join(keys)})`;
}
