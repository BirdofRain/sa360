export function ghlConnectionStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return status.replace(/_/g, " ");
}

export function ghlConnectionStatusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case "connected":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200";
    case "expired":
    case "error":
      return "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100";
    case "revoked":
      return "border-muted-foreground/40 bg-muted/40 text-muted-foreground";
    default:
      return "";
  }
}

export function validateLinkClientAccountId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Client account ID is required.";
  if (trimmed.length > 120) return "Client account ID is too long.";
  return null;
}
