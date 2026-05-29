const RISK_LABELS: Record<string, string> = {
  none: "None",
  possible_duplicate: "Possible duplicate",
  likely_duplicate: "Likely duplicate",
  source_duplicate: "Source duplicate",
};

const IDENTITY_LABELS: Record<string, string> = {
  linked: "Linked",
  needs_review: "Needs review",
  separate_person: "Separate person",
  ignored_test: "Ignored (test)",
  orphan_appointment: "Orphan appointment",
};

export function duplicateRiskLevelLabel(level: string): string {
  return RISK_LABELS[level] ?? level;
}

export function identityStatusLabel(status: string): string {
  return IDENTITY_LABELS[status] ?? status;
}

export function duplicateRiskBadgeClass(level: string): string {
  switch (level) {
    case "source_duplicate":
    case "likely_duplicate":
      return "border-destructive/50 bg-destructive/10 text-destructive";
    case "possible_duplicate":
      return "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200";
    default:
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200";
  }
}
