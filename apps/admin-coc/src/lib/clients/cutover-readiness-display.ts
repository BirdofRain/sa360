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

/**
 * Whether the legacy routing-rule checklist applies to this client.
 * An active rule whose master source is mapped is legacy master-source routing.
 * Zero rules, inactive-only rules, or an unreadable checklist are unknown.
 * Unknown does not mean routing is unnecessary.
 */
export type LegacyRoutingApplicability = "legacy_master_source" | "unknown";

const ACTIVE_RULE_DETAIL = /^(\d+) active of (\d+) total$/;

export function legacyMasterRoutingApplicability(
  report: Pick<ClientCutoverReadinessReport, "sections">
): LegacyRoutingApplicability {
  const section = report.sections.find((item) => item.key === "routing_rules");
  if (!section) return "unknown";
  const active = section.items.find((item) => item.key === "active_rule_exists");
  const master = section.items.find((item) => item.key === "rule_master_source");
  if (!active || !master || typeof active.detail !== "string" || typeof master.detail !== "string") {
    return "unknown";
  }
  const match = ACTIVE_RULE_DETAIL.exec(active.detail.trim());
  if (!match) return "unknown";
  const total = Number(match[2]);
  if (!Number.isInteger(total) || total <= 0) return "unknown";
  const masterDetail = master.detail.trim();
  if (master.complete && masterDetail.length > 0 && masterDetail !== "no master source") {
    return "legacy_master_source";
  }
  return "unknown";
}

export function legacyRoutingApplicabilityLabel(applicability: LegacyRoutingApplicability): string {
  return applicability === "legacy_master_source" ? "Applies to legacy master-source routing" : "Unknown";
}

export function isGhlDestinationBlocker(blocker: string): boolean {
  return blocker.startsWith("GHL destination is not configured") || blocker.startsWith("Destination:");
}

export function isLegacyRoutingRuleBlocker(blocker: string): boolean {
  return blocker.startsWith("No active routing rule");
}
