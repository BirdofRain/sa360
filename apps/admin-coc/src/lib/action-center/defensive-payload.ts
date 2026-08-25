export type CollectionAvailability = "ok" | "empty" | "unavailable";
export type SectionAvailability = "ok" | "unavailable";

export function readArray<T>(value: unknown): { items: T[]; available: boolean } {
  if (Array.isArray(value)) return { items: value as T[], available: true };
  return { items: [], available: false };
}

export function collectionAvailability(available: boolean, count: number): CollectionAvailability {
  if (!available) return "unavailable";
  return count > 0 ? "ok" : "empty";
}

export function formatUnknownLabel(raw: unknown): string {
  const text = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : "unspecified";
  return `Unknown (${text})`;
}

export function lookupRecord<T>(map: Record<string, T>, key: unknown): T | undefined {
  if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(map, key)) {
    return undefined;
  }
  return map[key];
}
