const TRUTHY = new Set(["1", "true", "yes", "on"]);

export function isBulkSourceImportsEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_SA360_BULK_SOURCE_IMPORTS_ENABLED?.trim().toLowerCase();
  if (!raw) return process.env.NODE_ENV === "development";
  return TRUTHY.has(raw);
}
