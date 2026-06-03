export type GhlLocationDeliveryReadiness =
  | "ready_for_delivery_config"
  | "link_client"
  | "probe_required"
  | "not_delivery_capable";

export type GhlOAuthPageBannerTone = "success" | "info" | "warn" | "error";

export function ghlConnectionStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return status.replace(/_/g, " ");
}

export function ghlConnectionStatusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case "connected":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200";
    case "pending_location":
    case "pending_token":
      return "border-sky-500/40 bg-sky-500/10 text-sky-900 dark:text-sky-100";
    case "expired":
    case "error":
      return "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100";
    case "revoked":
      return "border-muted-foreground/40 bg-muted/40 text-muted-foreground";
    default:
      return "";
  }
}

export function ghlDeliveryReadinessBadgeClass(hint: GhlLocationDeliveryReadiness): string {
  switch (hint) {
    case "ready_for_delivery_config":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200";
    case "link_client":
    case "probe_required":
      return "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100";
    case "not_delivery_capable":
      return "border-muted-foreground/40 bg-muted/40 text-muted-foreground";
  }
}

export function ghlDeliveryReadinessLabel(hint: GhlLocationDeliveryReadiness): string {
  switch (hint) {
    case "ready_for_delivery_config":
      return "Ready for delivery config";
    case "link_client":
      return "Link client";
    case "probe_required":
      return "Probe required";
    case "not_delivery_capable":
      return "Not delivery-capable";
  }
}

export function isGhlDeliverableConnection(status: string | null | undefined): boolean {
  return status === "connected";
}

export function validateLinkClientAccountId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Client account ID is required.";
  if (trimmed.length > 120) return "Client account ID is too long.";
  return null;
}

export function ghlOAuthBannerBorderClass(tone: GhlOAuthPageBannerTone): string {
  switch (tone) {
    case "success":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100";
    case "error":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "warn":
      return "border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100";
    case "info":
    default:
      return "border-border bg-muted/30 text-foreground";
  }
}
