/**
 * Bounded item scope for aged ops-verify runs.
 *
 * Lot-scale verify/activate is the legacy default. An explicit item scope lets a
 * single order be served without collaterally verifying or activating the rest of
 * the lot. Kept free of Prisma/db imports so it stays unit-testable.
 */

/**
 * Outcome of reading the operator's scope options.
 *
 * `omitted` and `invalid` must stay distinct. Omitting both options is the
 * legacy whole-lot run, but supplying one and leaving it blank means the
 * operator intended a bounded run and the ids were lost somewhere. Widening
 * that to the whole lot is exactly the over-activation the scope exists to
 * prevent, so it fails closed instead.
 */
export type ItemScopeArgument =
  | { kind: "omitted" }
  | { kind: "scoped"; inventoryItemIds: string[] }
  | { kind: "invalid"; reason: string };

/**
 * Read a scope option straight from `argv`.
 *
 * Returns `null` when the option is absent and `""` when it was supplied
 * without a usable value (`--opt` at the end of the line, `--opt ""`, or
 * `--opt --next-flag`). That distinction is the whole safety property, and a
 * generic arg parser that substitutes a default for a missing value destroys
 * it before it can be acted on — hence reading argv directly for these two.
 */
export function readScopeOptionFromArgv(argv: string[], option: string): string | null {
  const at = argv.lastIndexOf(`--${option}`);
  if (at === -1) return null;
  const next = argv[at + 1];
  return next === undefined || next.startsWith("--") ? "" : next;
}

/** Comma and/or whitespace separated, so a flag value and a file body behave identically. */
function tokenizeItemScope(source: string): string[] {
  return source
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Decide the verify/activate scope from the two operator options.
 *
 * `null` means the option was not supplied at all; `""` means it was supplied
 * and carried nothing usable. The caller is responsible for preserving that
 * difference — a CLI that folds a missing value into a default string would
 * destroy it before this function runs.
 *
 * The file wins over the inline list so a long id set never has to fit on a
 * command line. A supplied-but-empty file therefore fails closed even if an
 * inline list is also present: the operator pointed at a file and that file did
 * not contain what they expected.
 */
export function resolveItemScopeArgument(input: {
  inline?: string | null;
  file?: string | null;
  filePath?: string | null;
}): ItemScopeArgument {
  const fileSupplied = input.file != null;
  const inlineSupplied = input.inline != null;
  if (!fileSupplied && !inlineSupplied) return { kind: "omitted" };

  const source = fileSupplied ? input.file! : input.inline!;
  const ids = tokenizeItemScope(source);
  if (ids.length > 0) return { kind: "scoped", inventoryItemIds: ids };

  const option = fileSupplied
    ? `--inventory-item-ids-file${input.filePath ? ` ${input.filePath}` : ""}`
    : "--inventory-item-ids";
  return {
    kind: "invalid",
    reason:
      `${option} was supplied but contains no inventory item ids. ` +
      "Refusing to fall back to a whole-lot run; omit both scope options to intend that.",
  };
}

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
