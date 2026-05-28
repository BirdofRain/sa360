import type { GhlAdapterRunItem, GhlAdapterValidation } from "./types.ts";

export function ghlAdapterStatusLabel(status: string | null | undefined): string {
  if (!status) return "Not run";
  return status.replace(/_/g, " ");
}

export function ghlAdapterStatusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case "simulated":
    case "readonly_probe_passed":
      return "border-emerald-600/35 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-100";
    case "failed_validation":
    case "readonly_probe_failed":
      return "border-amber-600/35 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100";
    case "disabled":
    case "blocked":
      return "border-slate-400/40 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-200";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function formatGhlAdapterValidation(validation: GhlAdapterValidation): string {
  const lines: string[] = [];
  if (validation.errors.length) {
    lines.push("Errors:", ...validation.errors.map((e) => `• ${e}`));
  }
  if (validation.warnings.length) {
    lines.push("Warnings:", ...validation.warnings.map((w) => `• ${w}`));
  }
  if (validation.missingConfig.length) {
    lines.push("Missing config:", ...validation.missingConfig.map((m) => `• ${m}`));
  }
  return lines.join("\n");
}

export function redactRequestPreview(json: unknown): string {
  if (json === null || json === undefined) return "—";
  try {
    const text = JSON.stringify(json, null, 2);
    return text.replace(/Bearer\s+\S+/gi, "[REDACTED]");
  } catch {
    return String(json);
  }
}

export function ghlAdapterModeLabel(mode: string | null | undefined): string {
  if (!mode) return "unknown";
  return mode.replace(/_/g, " ");
}

export function lastRunSummary(run: GhlAdapterRunItem | null): string | null {
  if (!run) return null;
  return run.summary ?? `${run.status} at ${new Date(run.startedAt).toLocaleString()}`;
}
