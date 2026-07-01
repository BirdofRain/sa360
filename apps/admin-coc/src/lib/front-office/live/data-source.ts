import type { FrontOfficeDataSource } from "../types";

export function resolveDataSource(liveCount: number, total: number): FrontOfficeDataSource {
  if (total === 0 || liveCount === 0) return "mock";
  if (liveCount >= total) return "live";
  return "partial_live";
}
