const ROUTING_AUTHORITY_LABELS: Record<string, string> = {
  campaign_routing_rule: "Campaign routing rule",
  confirmed_source_association: "Confirmed source association",
  operator_selected_destination: "Operator-selected destination",
};

export function routingAuthorityLabel(authority: string | null | undefined): string {
  const normalized = authority?.trim();
  if (!normalized) return "—";
  return ROUTING_AUTHORITY_LABELS[normalized] ?? normalized;
}
