/**
 * Feature flag and persisted UI preference for C.O.C. detail overlay mode.
 * Roll back instantly: unset NEXT_PUBLIC_SA360_COC_DETAIL_OVERLAY_ENABLED or set to "false".
 */

export type CocDetailViewMode = "overlay" | "docked";

export const COC_DETAIL_VIEW_MODE_STORAGE_KEY = "sa360:coc:detailViewMode";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** When true, operational detail views use DetailOverlay instead of legacy Sheet drawers. */
export function isCocDetailOverlayEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_SA360_COC_DETAIL_OVERLAY_ENABLED?.trim().toLowerCase();
  if (!raw) return false;
  return TRUTHY.has(raw);
}

export function parseCocDetailViewMode(value: string | null | undefined): CocDetailViewMode {
  return value === "docked" ? "docked" : "overlay";
}

export function readStoredCocDetailViewMode(): CocDetailViewMode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COC_DETAIL_VIEW_MODE_STORAGE_KEY);
    if (raw === "overlay" || raw === "docked") return raw;
    return null;
  } catch {
    return null;
  }
}

export function writeStoredCocDetailViewMode(mode: CocDetailViewMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COC_DETAIL_VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    /* ignore quota / private mode */
  }
}

export function defaultCocDetailViewMode(): CocDetailViewMode {
  return "overlay";
}
