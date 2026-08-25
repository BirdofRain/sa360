export type PortalTrustCardView = {
  key: string;
  title: string;
  status: string;
  statusLabel: string;
  summary: string;
  warnings: string[];
};

export type PortalTrustView = {
  generatedAt: string | null;
  cards: PortalTrustCardView[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatLabel(value: string): string {
  return value.replace(/_/g, " ");
}

export function portalTrustStatusLabel(status: string): string {
  switch (status) {
    case "verified":
      return "Verified";
    case "warning":
      return "Needs attention";
    case "needs_setup":
      return "Needs setup";
    case "failed":
      return "Failed";
    case "not_connected":
      return "Not connected";
    case "mock":
      return "Preview";
    default:
      return formatLabel(status);
  }
}

export function portalTrustStatusTone(
  status: string
): "good" | "warn" | "bad" | "neutral" {
  if (status === "verified") return "good";
  if (status === "warning" || status === "needs_setup" || status === "not_connected") {
    return "warn";
  }
  if (status === "failed") return "bad";
  return "neutral";
}

export function mapClientTrustCenter(raw: unknown): PortalTrustView | null {
  const root = asRecord(raw);
  if (!root) return null;
  const cardsRaw = Array.isArray(root.cards) ? root.cards : [];
  const cards: PortalTrustCardView[] = [];
  for (const item of cardsRaw) {
    const card = asRecord(item);
    if (!card) continue;
    const key = asString(card.key);
    const title = asString(card.title);
    if (!key || !title) continue;
    const status = asString(card.status) ?? "needs_setup";
    const warnings = Array.isArray(card.warnings)
      ? card.warnings.map((w) => asString(w)).filter((w): w is string => Boolean(w))
      : [];
    cards.push({
      key,
      title,
      status,
      statusLabel: portalTrustStatusLabel(status),
      summary: asString(card.summary) ?? "Status unavailable.",
      warnings,
    });
  }
  return {
    generatedAt: asString(root.generatedAt),
    cards,
  };
}
