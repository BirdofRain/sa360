import type { GhlLiveCanaryPreflight } from "./types";

export function ghlLiveRunStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return status.replace(/_/g, " ");
}

export function ghlLiveRunStatusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case "succeeded":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200";
    case "partial_success":
      return "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100";
    case "failed":
    case "blocked":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "skipped_duplicate":
      return "border-muted-foreground/40 bg-muted/40 text-muted-foreground";
    case "executing":
      return "border-blue-500/40 bg-blue-500/10 text-blue-900 dark:text-blue-100";
    default:
      return "";
  }
}

export function liveCanaryCanRunFromPreflight(preflight: GhlLiveCanaryPreflight | null): boolean {
  return Boolean(preflight?.canExecute);
}

export function truncateIdempotencyKey(key: string | null | undefined): string {
  if (!key) return "—";
  if (key.length <= 16) return key;
  return `${key.slice(0, 8)}…${key.slice(-8)}`;
}
