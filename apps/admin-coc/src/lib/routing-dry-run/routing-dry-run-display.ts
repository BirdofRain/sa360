import type { RoutingAttributionSnapshot, RoutingDryRunDecisionItem } from "./types";

export function formatRoutingDryRunTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function matchStatusLabel(row: Pick<RoutingDryRunDecisionItem, "matched">): string {
  return row.matched ? "Matched" : "Review required";
}

export function confidenceBadgeClass(confidence: string | null | undefined, matched: boolean): string {
  if (!matched) {
    return "border-amber-600/35 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100";
  }
  const c = (confidence ?? "unknown").toLowerCase();
  if (c === "high") {
    return "border-emerald-600/35 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-100";
  }
  if (c === "medium") {
    return "border-sky-600/35 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100";
  }
  if (c === "low") {
    return "border-slate-400/40 bg-slate-100 text-slate-800 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-200";
  }
  return "bg-muted text-muted-foreground";
}

export function matchBadgeClass(matched: boolean): string {
  if (matched) {
    return "border-emerald-600/35 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-100";
  }
  return "border-amber-600/35 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100";
}

export function deliveryModeBadgeClass(): string {
  return "border-violet-600/35 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100";
}

export function displayMatchType(matchType: string | null | undefined): string {
  if (!matchType) return "—";
  return matchType.replace(/_/g, " ");
}

export function displayLeadLabel(row: RoutingDryRunDecisionItem): string {
  const id = row.leadIdentity;
  if (id?.displayName) return id.displayName;
  if (id?.firstName || id?.lastName) {
    return [id.firstName, id.lastName].filter(Boolean).join(" ");
  }
  return "—";
}

export function parseAttributionSnapshot(raw: unknown): RoutingAttributionSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as RoutingAttributionSnapshot;
}

export function destinationClientLabel(row: RoutingDryRunDecisionItem): string {
  return (
    row.matchedRuleSummary?.clientDisplayName?.trim() ||
    row.destinationClientAccountId?.trim() ||
    "—"
  );
}
