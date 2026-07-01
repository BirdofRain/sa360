import {
  fetchAdminDeliveryReadiness,
  fetchAdminGhlConnections,
  fetchAdminMetricsSummary,
  fetchAutomationSignalHealth,
} from "@/lib/admin-api/server";

import type { TrustCheckCard, TrustCheckKey } from "../types";
import type { LiveBridgeScope } from "./config";
import {
  buildClientSnapshotCard,
  buildDeliveryReadinessCard,
  buildGhlConnectionCard,
  buildRequiredFieldsCard,
  buildRoutingRuleReadinessCard,
  buildSignalHealthCard,
  buildWebhookHealthCard,
  buildWorkflowPipelineCard,
} from "./trust-builders";

export const CARD_KEYS: TrustCheckKey[] = [
  "ghl_connection",
  "delivery_readiness",
  "required_fields",
  "workflow_pipeline_config",
  "webhook_health",
  "routing_rule_readiness",
  "signal_health",
  "client_snapshot_readiness",
];

type CardBuilder = (
  slices: Awaited<ReturnType<typeof fetchTrustLiveSlices>>,
  now: string
) => TrustCheckCard | null;

export const BUILDERS: Record<TrustCheckKey, CardBuilder> = {
  ghl_connection: (s, now) => buildGhlConnectionCard(s.ghlItems, now),
  delivery_readiness: (s, now) => buildDeliveryReadinessCard(s.rules, now),
  required_fields: (s, now) => buildRequiredFieldsCard(s.rules, now),
  workflow_pipeline_config: (s, now) => buildWorkflowPipelineCard(s.rules, now),
  webhook_health: (s, now) => buildWebhookHealthCard(s.metrics, s.signal, now),
  routing_rule_readiness: (s, now) => buildRoutingRuleReadinessCard(s.rules, now),
  signal_health: (s, now) => buildSignalHealthCard(s.signal, now),
  client_snapshot_readiness: (s, now) => buildClientSnapshotCard(s.rules, now),
};

export async function fetchTrustLiveSlices(scope: LiveBridgeScope) {
  const clientAccountId = scope.clientAccountId?.trim();
  const readinessParams = clientAccountId ? { clientAccountId } : {};
  const signalParams = clientAccountId ? { clientAccountId } : undefined;

  const [ghlRes, readinessRes, metricsRes, signalRes] = await Promise.all([
    fetchAdminGhlConnections(clientAccountId),
    fetchAdminDeliveryReadiness(readinessParams),
    fetchAdminMetricsSummary(),
    fetchAutomationSignalHealth(signalParams),
  ]);

  return {
    ghlItems: ghlRes.data?.items ?? [],
    rules: readinessRes.data?.items ?? [],
    metrics: metricsRes.summary ?? null,
    signal: signalRes.data ?? null,
    errors: [ghlRes.error, readinessRes.error, metricsRes.error, signalRes.error].filter(
      Boolean
    ) as string[],
  };
}

export function mergeCard(key: TrustCheckKey, live: TrustCheckCard | null, mock: TrustCheckCard): TrustCheckCard {
  if (!live) {
    return {
      ...mock,
      status: "mock",
      source: "mock",
      checks: mock.checks.map((c) => ({ ...c, source: "mock" as const })),
    };
  }
  return live;
}
