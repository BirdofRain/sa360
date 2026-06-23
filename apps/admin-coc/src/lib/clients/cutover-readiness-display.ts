import type {
  ClientCutoverOverallStatus,
  ClientCutoverReadinessReport,
  CutoverChecklistItem,
  CutoverReadinessSection,
} from "./cutover-readiness-types";

const OVERALL_STATUSES: ClientCutoverOverallStatus[] = [
  "not_ready",
  "ready_for_shadow",
  "ready_for_live_review",
  "blocked",
];

export function overallStatusLabel(
  status: ClientCutoverOverallStatus | string | null | undefined
): string {
  switch (status) {
    case "ready_for_live_review":
      return "Ready for live review";
    case "ready_for_shadow":
      return "Ready for shadow";
    case "blocked":
      return "Blocked";
    case "not_ready":
      return "Not ready";
    default:
      return "Unknown";
  }
}

export function overallStatusBadgeClass(
  status: ClientCutoverOverallStatus | string | null | undefined
): string {
  switch (status) {
    case "ready_for_live_review":
      return "border-emerald-600/35 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-100";
    case "ready_for_shadow":
      return "border-violet-600/35 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100";
    case "blocked":
      return "border-red-600/35 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100";
    case "not_ready":
      return "border-amber-600/35 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function safeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function normalizeItem(value: unknown): CutoverChecklistItem | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const key = safeString(raw.key);
  const label = safeString(raw.label);
  if (!key || !label) return null;
  return {
    key,
    label,
    complete: raw.complete === true,
    detail: typeof raw.detail === "string" ? raw.detail : undefined,
  };
}

function normalizeSection(value: unknown): CutoverReadinessSection | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const key = safeString(raw.key) as CutoverReadinessSection["key"];
  const label = safeString(raw.label);
  if (!key || !label) return null;
  const items = Array.isArray(raw.items)
    ? raw.items.map(normalizeItem).filter((i): i is CutoverChecklistItem => i !== null)
    : [];
  return {
    key,
    label,
    complete: raw.complete === true,
    items,
  };
}

/**
 * Defensively normalize a possibly-partial or malformed report from the API so
 * the panel never throws while rendering. Read-only; performs no side effects.
 */
export function normalizeCutoverReadinessReport(
  value: unknown
): ClientCutoverReadinessReport | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const clientAccountId = safeString(raw.clientAccountId);
  if (!clientAccountId) return null;
  const overallStatus = OVERALL_STATUSES.includes(
    raw.overallStatus as ClientCutoverOverallStatus
  )
    ? (raw.overallStatus as ClientCutoverOverallStatus)
    : "not_ready";
  const sections = Array.isArray(raw.sections)
    ? raw.sections
        .map(normalizeSection)
        .filter((s): s is CutoverReadinessSection => s !== null)
    : [];
  return {
    clientAccountId,
    clientDisplayName: safeString(raw.clientDisplayName, clientAccountId),
    status: safeString(raw.status, "unknown"),
    generatedAt: safeString(raw.generatedAt),
    overallStatus,
    sections,
    blockers: safeStringList(raw.blockers),
    warnings: safeStringList(raw.warnings),
    manualNextSteps: safeStringList(raw.manualNextSteps),
  };
}

export function countSectionProgress(section: CutoverReadinessSection): {
  complete: number;
  total: number;
} {
  return {
    complete: section.items.filter((i) => i.complete).length,
    total: section.items.length,
  };
}
