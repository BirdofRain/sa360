import type { AdminMetricsSummary } from "../admin-metrics.service.js";
import type { AutomationSignalHealthResponse } from "../automation-dashboard.service.js";
import type { RoutingRuleWithReadinessItem } from "../delivery-readiness-admin.present.js";
import type { GhlLocationConnectionAdminItem } from "../ghl-oauth/ghl-oauth-admin.present.js";
import type { FrontOfficeTrustCard, FrontOfficeTrustCardKey, FrontOfficeTrustStatus } from "./front-office.types.js";

export function mapGhlConnectionStatus(status: string): FrontOfficeTrustStatus {
  const s = status.toLowerCase();
  if (s === "connected") return "verified";
  if (s === "revoked" || s === "error") return "failed";
  if (s.startsWith("pending")) return "needs_setup";
  return "warning";
}

export function worstTrustStatus(statuses: FrontOfficeTrustStatus[]): FrontOfficeTrustStatus {
  const rank: Record<FrontOfficeTrustStatus, number> = {
    failed: 5,
    not_connected: 4,
    needs_setup: 3,
    warning: 2,
    mock: 1,
    verified: 0,
  };
  return statuses.reduce(
    (worst, s) => (rank[s] > rank[worst] ? s : worst),
    "verified" as FrontOfficeTrustStatus
  );
}

export function buildGhlConnectionCard(
  items: GhlLocationConnectionAdminItem[],
  now: string
): FrontOfficeTrustCard | null {
  if (!items.length) return null;
  const connected = items.filter((i) => i.connectionStatus === "connected").length;
  const details = items.slice(0, 5).map((item) => ({
    id: `ghl-${item.id}`,
    label: item.locationName ?? item.locationId,
    status: mapGhlConnectionStatus(item.connectionStatus),
    detail:
      item.connectionStatus === "connected"
        ? item.deliveryReadinessHint === "ready_for_delivery_config"
          ? "Connected and ready for delivery config"
          : "Connected"
        : item.lastError
          ? `Connection issue — ${item.lastError.slice(0, 120)}`
          : `Status: ${item.connectionStatus}`,
    adminDetail: item.lastProbeAt
      ? `Probe ${item.lastProbeAt}; token expires ${item.tokenExpiresAt}`
      : undefined,
  }));

  const status = worstTrustStatus(details.map((c) => c.status));
  return {
    key: "ghl_connection",
    title: "GHL Connection",
    status,
    source: "live",
    summary: `${connected}/${items.length} locations connected`,
    lastCheckedAt: items.reduce<string>(
      (max, i) => (i.lastProbeAt && i.lastProbeAt > max ? i.lastProbeAt : max),
      now
    ),
    warnings: details.filter((d) => d.status !== "verified").map((d) => d.detail),
    details,
  };
}

export function buildDeliveryReadinessCard(
  rules: RoutingRuleWithReadinessItem[],
  now: string
): FrontOfficeTrustCard | null {
  if (!rules.length) return null;
  const ready = rules.filter((r) => r.readiness.readyForLive).length;
  const blocked = rules.filter((r) => r.readiness.blockers.length > 0).length;
  const details = rules.slice(0, 6).map((rule) => ({
    id: `dr-${rule.id}`,
    label: rule.campaignName ?? rule.clientDisplayName ?? rule.id,
    status: (rule.readiness.readyForLive
      ? "verified"
      : rule.readiness.blockers.length
        ? "failed"
        : "needs_setup") as FrontOfficeTrustStatus,
    detail: rule.readiness.recommendedNextAction || rule.readiness.readinessStatus,
    adminDetail:
      rule.readiness.blockers.length > 0
        ? `Blockers: ${rule.readiness.blockers.join("; ")}`
        : undefined,
  }));

  return {
    key: "delivery_readiness",
    title: "Delivery Readiness",
    status: blocked > 0 ? "warning" : ready === rules.length ? "verified" : "needs_setup",
    source: "live",
    summary:
      blocked > 0
        ? `${blocked} rule(s) blocked · ${ready}/${rules.length} ready for live`
        : `${ready}/${rules.length} rules ready for live delivery`,
    lastCheckedAt:
      rules.reduce<string | null>(
        (max, r) =>
          r.lastReadinessCheckAt && (!max || r.lastReadinessCheckAt > max)
            ? r.lastReadinessCheckAt
            : max,
        null
      ) ?? now,
    warnings: details.filter((d) => d.status !== "verified").map((d) => d.detail),
    details,
  };
}

export function buildRequiredFieldsCard(
  rules: RoutingRuleWithReadinessItem[],
  now: string
): FrontOfficeTrustCard | null {
  if (!rules.length) return null;
  const details = rules.slice(0, 6).map((rule) => {
    const mapping = rule.readiness.fieldMapping;
    const complete = mapping?.coreRequiredComplete ?? rule.requiredFieldsInstalled;
    return {
      id: `rf-${rule.id}`,
      label: rule.clientDisplayName ?? rule.campaignName ?? "Routing rule",
      status: (complete ? "verified" : "needs_setup") as FrontOfficeTrustStatus,
      detail: complete
        ? "Core required fields mapped"
        : `${mapping?.coreRequiredMissing?.length ?? 0} required field(s) missing`,
      adminDetail: mapping?.coreRequiredMissing?.length
        ? `Missing: ${mapping.coreRequiredMissing.join(", ")}`
        : undefined,
    };
  });

  const allComplete = details.every((c) => c.status === "verified");
  return {
    key: "required_fields",
    title: "Required Fields",
    status: allComplete ? "verified" : "needs_setup",
    source: "live",
    summary: allComplete
      ? "Required custom fields detected on all active rules"
      : "Some rules missing required field mappings",
    lastCheckedAt: now,
    warnings: details.filter((d) => d.status !== "verified").map((d) => d.detail),
    details,
  };
}

export function buildWorkflowPipelineCard(
  rules: RoutingRuleWithReadinessItem[],
  now: string
): FrontOfficeTrustCard | null {
  if (!rules.length) return null;
  const details = rules.slice(0, 6).map((rule) => {
    const hasWorkflow = Boolean(rule.destinationWorkflowIdGhl);
    const hasPipeline = Boolean(rule.destinationPipelineIdGhl && rule.destinationPipelineStageIdGhl);
    const complete = hasWorkflow && hasPipeline;
    return {
      id: `wp-${rule.id}`,
      label: rule.campaignName ?? rule.clientDisplayName ?? "Rule",
      status: (complete ? "verified" : hasWorkflow || hasPipeline ? "warning" : "needs_setup") as FrontOfficeTrustStatus,
      detail: complete
        ? "Workflow and pipeline/stage configured"
        : hasWorkflow
          ? "Workflow set — pipeline/stage incomplete"
          : "Workflow/pipeline not fully configured",
      adminDetail: `workflow=${rule.destinationWorkflowIdGhl ?? "—"} pipeline=${rule.destinationPipelineIdGhl ?? "—"}`,
    };
  });

  return {
    key: "workflow_pipeline_config",
    title: "Workflow / Pipeline Config",
    status: worstTrustStatus(details.map((c) => c.status)),
    source: "live",
    summary: "Pipeline and workflow completeness across routing rules",
    lastCheckedAt: now,
    warnings: details.filter((d) => d.status !== "verified").map((d) => d.detail),
    details,
  };
}

export function buildWebhookHealthCard(
  metrics: AdminMetricsSummary | null,
  signal: AutomationSignalHealthResponse | null,
  now: string
): FrontOfficeTrustCard | null {
  if (!metrics && !signal) return null;
  const details: FrontOfficeTrustCard["details"] = [];
  if (metrics) {
    const failRate =
      metrics.webhookRequestsTotal > 0
        ? metrics.webhookFailures / metrics.webhookRequestsTotal
        : 0;
    details.push({
      id: "wh-receipt",
      label: "Inbound webhook receipt",
      status: metrics.webhookRequestsToday > 0 ? "verified" : "warning",
      detail: `${metrics.webhookRequestsToday} received today`,
    });
    details.push({
      id: "wh-latency",
      label: "Processing latency",
      status:
        metrics.averageWebhookDurationMs != null && metrics.averageWebhookDurationMs < 2000
          ? "verified"
          : "warning",
      detail:
        metrics.averageWebhookDurationMs != null
          ? `Avg ${Math.round(metrics.averageWebhookDurationMs)}ms`
          : "Latency data unavailable",
    });
    details.push({
      id: "wh-failures",
      label: "Failure rate",
      status: failRate > 0.05 ? "failed" : failRate > 0 ? "warning" : "verified",
      detail: `${metrics.webhookFailures} failures of ${metrics.webhookRequestsTotal} total`,
      adminOnly: true,
      adminDetail: `Validation failures: ${metrics.webhookValidationFailures}`,
    });
  }
  if (signal) {
    details.push({
      id: "wh-validation",
      label: "Validation failures",
      status: signal.validationFailures > 0 ? "warning" : "verified",
      detail:
        signal.validationFailures > 0
          ? `${signal.validationFailures} validation failure(s) in range`
          : "No validation failures in range",
    });
  }
  if (!details.length) return null;

  return {
    key: "webhook_health",
    title: "Webhook Health",
    status: worstTrustStatus(details.map((c) => c.status)),
    source: "live",
    summary: metrics?.latestWebhookAt
      ? `Last webhook ${new Date(metrics.latestWebhookAt).toLocaleString()}`
      : "Webhook pipeline monitored",
    lastCheckedAt: metrics?.latestWebhookAt ?? now,
    warnings: details.filter((d) => d.status !== "verified").map((d) => d.detail),
    details,
  };
}

export function buildRoutingRuleReadinessCard(
  rules: RoutingRuleWithReadinessItem[],
  now: string
): FrontOfficeTrustCard | null {
  if (!rules.length) return null;
  const active = rules.filter((r) => r.active).length;
  const details: FrontOfficeTrustCard["details"] = [
    {
      id: "rr-active",
      label: "Active rules",
      status: active > 0 ? "verified" : "needs_setup",
      detail: `${active} of ${rules.length} rules active`,
    },
    {
      id: "rr-readiness",
      label: "Readiness checks",
      status: rules.some((r) => r.readiness.blockers.length) ? "warning" : "verified",
      detail: rules.some((r) => r.readiness.blockers.length)
        ? `${rules.filter((r) => r.readiness.blockers.length).length} rule(s) with blockers`
        : "All active rules pass readiness checks",
    },
    {
      id: "rr-fallback",
      label: "Fallback routing",
      status: rules.some((r) => r.backupSheetEnabled || r.deliveryMode === "shadow")
        ? "verified"
        : "warning",
      detail: "Shadow/backup routing configured where required",
    },
  ];

  return {
    key: "routing_rule_readiness",
    title: "Routing Rule Readiness",
    status: worstTrustStatus(details.map((c) => c.status)),
    source: "live",
    summary: `${active} active routing rules monitored`,
    lastCheckedAt: now,
    warnings: details.filter((d) => d.status !== "verified").map((d) => d.detail),
    details,
  };
}

export function buildSignalHealthCard(
  signal: AutomationSignalHealthResponse | null,
  now: string
): FrontOfficeTrustCard | null {
  if (!signal) return null;
  const details: FrontOfficeTrustCard["details"] = [
    {
      id: "sig-sent",
      label: "Signals sent",
      status: signal.signalSent > 0 ? "verified" : "warning",
      detail: `${signal.signalSent} signal(s) sent in range`,
    },
    {
      id: "sig-failed",
      label: "Signal failures",
      status: signal.signalFailed > 0 ? "warning" : "verified",
      detail:
        signal.signalFailed > 0
          ? `${signal.signalFailed} failure(s) in range`
          : "No signal failures in range",
    },
    {
      id: "sig-webhook",
      label: "Webhook failures (signal path)",
      status: signal.webhookFailures > 0 ? "warning" : "verified",
      detail: `${signal.webhookFailures} webhook failure(s) affecting signals`,
      adminOnly: true,
    },
  ];

  return {
    key: "signal_health",
    title: "Signal Health",
    status: worstTrustStatus(details.map((c) => c.status)),
    source: "live",
    summary: signal.lastSuccessfulSignalAt
      ? `Last successful signal ${new Date(signal.lastSuccessfulSignalAt).toLocaleString()}`
      : "Automation signal health summary",
    lastCheckedAt: signal.lastSuccessfulSignalAt ?? now,
    warnings: details.filter((d) => d.status !== "verified").map((d) => d.detail),
    details,
  };
}

export function buildClientSnapshotCard(
  rules: RoutingRuleWithReadinessItem[],
  now: string
): FrontOfficeTrustCard | null {
  if (!rules.length) return null;
  const details: FrontOfficeTrustCard["details"] = [
    {
      id: "snap-pipeline",
      label: "Pipeline snapshot",
      status: rules.every((r) => r.snapshotInstalled) ? "verified" : "needs_setup",
      detail: `${rules.filter((r) => r.snapshotInstalled).length}/${rules.length} rules with snapshot installed`,
    },
    {
      id: "snap-fields",
      label: "Custom fields sync",
      status: rules.every((r) => r.requiredFieldsInstalled) ? "verified" : "warning",
      detail: "Required CRM fields installed on destinations",
    },
    {
      id: "snap-tags",
      label: "Config completeness",
      status: rules.some((r) => r.readiness.warnings.length) ? "warning" : "verified",
      detail: rules.some((r) => r.readiness.warnings.length)
        ? `${rules.filter((r) => r.readiness.warnings.length).length} rule(s) with config warnings`
        : "No config warnings on active rules",
      adminOnly: true,
    },
  ];

  return {
    key: "client_snapshot_readiness",
    title: "Client Snapshot Readiness",
    status: worstTrustStatus(details.map((c) => c.status)),
    source: "live",
    summary: "CRM snapshot and field readiness for active clients",
    lastCheckedAt: now,
    warnings: details.filter((d) => d.status !== "verified").map((d) => d.detail),
    details,
  };
}

export type TrustSliceData = {
  ghlItems: GhlLocationConnectionAdminItem[];
  rules: RoutingRuleWithReadinessItem[];
  metrics: AdminMetricsSummary | null;
  signal: AutomationSignalHealthResponse | null;
};

export type TrustCardBuilder = (
  slices: TrustSliceData,
  now: string
) => FrontOfficeTrustCard | null;

export const TRUST_CARD_BUILDERS: Record<FrontOfficeTrustCardKey, TrustCardBuilder> = {
  ghl_connection: (s, now) => buildGhlConnectionCard(s.ghlItems, now),
  delivery_readiness: (s, now) => buildDeliveryReadinessCard(s.rules, now),
  required_fields: (s, now) => buildRequiredFieldsCard(s.rules, now),
  workflow_pipeline_config: (s, now) => buildWorkflowPipelineCard(s.rules, now),
  webhook_health: (s, now) => buildWebhookHealthCard(s.metrics, s.signal, now),
  routing_rule_readiness: (s, now) => buildRoutingRuleReadinessCard(s.rules, now),
  signal_health: (s, now) => buildSignalHealthCard(s.signal, now),
  client_snapshot_readiness: (s, now) => buildClientSnapshotCard(s.rules, now),
};

export function mockTrustCard(key: FrontOfficeTrustCardKey, now: string): FrontOfficeTrustCard {
  const titles: Record<FrontOfficeTrustCardKey, string> = {
    ghl_connection: "GHL Connection",
    delivery_readiness: "Delivery Readiness",
    required_fields: "Required Fields",
    workflow_pipeline_config: "Workflow / Pipeline Config",
    webhook_health: "Webhook Health",
    routing_rule_readiness: "Routing Rule Readiness",
    signal_health: "Signal Health",
    client_snapshot_readiness: "Client Snapshot Readiness",
  };
  return {
    key,
    title: titles[key],
    status: "mock",
    source: "mock",
    summary: "Preview data — connect live sources for operational checks",
    lastCheckedAt: now,
    warnings: [],
    details: [],
  };
}
