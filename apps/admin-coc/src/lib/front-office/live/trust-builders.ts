import type { AdminMetricsSummary, AutomationSignalHealth } from "@/lib/admin-api/types";
import type { GhlLocationConnectionItem } from "@/lib/ghl-connections/types";
import type { RoutingRuleWithReadinessItem } from "@/lib/delivery-readiness/types";

import type { TrustCheckCard, TrustCheckDetail, TrustStatus } from "../types";

export function mapGhlConnectionStatus(status: string): TrustStatus {
  const s = status.toLowerCase();
  if (s === "connected") return "verified";
  if (s === "revoked" || s === "error") return "failed";
  if (s.startsWith("pending")) return "needs_setup";
  return "warning";
}

export function worstTrustStatus(statuses: TrustStatus[]): TrustStatus {
  const rank: Record<TrustStatus, number> = {
    failed: 5,
    not_connected: 4,
    needs_setup: 3,
    warning: 2,
    mock: 1,
    verified: 0,
  };
  return statuses.reduce(
    (worst, s) => (rank[s] > rank[worst] ? s : worst),
    "verified" as TrustStatus
  );
}

export function buildGhlConnectionCard(
  items: GhlLocationConnectionItem[],
  now: string
): TrustCheckCard | null {
  if (!items.length) return null;
  const connected = items.filter((i) => i.connectionStatus === "connected").length;
  const checks: TrustCheckDetail[] = items.slice(0, 5).map((item) => ({
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
    source: "live",
    adminDetail: item.lastProbeAt
      ? `Probe ${item.lastProbeAt}; token expires ${item.tokenExpiresAt}`
      : undefined,
  }));

  const status = worstTrustStatus(checks.map((c) => c.status));
  return {
    key: "ghl_connection",
    label: "GHL Connection",
    status,
    headline: `${connected}/${items.length} locations connected`,
    lastCheckedAt: items.reduce<string>(
      (max, i) => (i.lastProbeAt && i.lastProbeAt > max ? i.lastProbeAt : max),
      now
    ),
    checks,
    source: "live",
  };
}

export function buildDeliveryReadinessCard(
  rules: RoutingRuleWithReadinessItem[],
  now: string
): TrustCheckCard | null {
  if (!rules.length) return null;
  const ready = rules.filter((r) => r.readiness.readyForLive).length;
  const blocked = rules.filter((r) => r.readiness.blockers.length > 0).length;
  const checks: TrustCheckDetail[] = rules.slice(0, 6).map((rule) => ({
    id: `dr-${rule.id}`,
    label: rule.campaignName ?? rule.clientDisplayName ?? rule.id,
    status: rule.readiness.readyForLive
      ? "verified"
      : rule.readiness.blockers.length
        ? "failed"
        : "needs_setup",
    detail: rule.readiness.recommendedNextAction || rule.readiness.readinessStatus,
    source: "live",
    adminDetail:
      rule.readiness.blockers.length > 0
        ? `Blockers: ${rule.readiness.blockers.join("; ")}`
        : undefined,
  }));

  return {
    key: "delivery_readiness",
    label: "Delivery Readiness",
    status: blocked > 0 ? "warning" : ready === rules.length ? "verified" : "needs_setup",
    headline:
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
    checks,
    source: "live",
  };
}

export function buildRequiredFieldsCard(
  rules: RoutingRuleWithReadinessItem[],
  now: string
): TrustCheckCard | null {
  if (!rules.length) return null;
  const checks: TrustCheckDetail[] = rules.slice(0, 6).map((rule) => {
    const mapping = rule.readiness.fieldMapping;
    const complete = mapping?.coreRequiredComplete ?? rule.requiredFieldsInstalled;
    return {
      id: `rf-${rule.id}`,
      label: rule.clientDisplayName ?? rule.campaignName ?? "Routing rule",
      status: complete ? "verified" : "needs_setup",
      detail: complete
        ? "Core required fields mapped"
        : `${mapping?.coreRequiredMissing?.length ?? 0} required field(s) missing`,
      source: "live",
      adminDetail: mapping?.coreRequiredMissing?.length
        ? `Missing: ${mapping.coreRequiredMissing.join(", ")}`
        : undefined,
    };
  });

  const allComplete = checks.every((c) => c.status === "verified");
  return {
    key: "required_fields",
    label: "Required Fields",
    status: allComplete ? "verified" : "needs_setup",
    headline: allComplete
      ? "Required custom fields detected on all active rules"
      : "Some rules missing required field mappings",
    lastCheckedAt: now,
    checks,
    source: "live",
  };
}

export function buildWorkflowPipelineCard(
  rules: RoutingRuleWithReadinessItem[],
  now: string
): TrustCheckCard | null {
  if (!rules.length) return null;
  const checks: TrustCheckDetail[] = rules.slice(0, 6).map((rule) => {
    const hasWorkflow = Boolean(rule.destinationWorkflowIdGhl);
    const hasPipeline = Boolean(rule.destinationPipelineIdGhl && rule.destinationPipelineStageIdGhl);
    const complete = hasWorkflow && hasPipeline;
    return {
      id: `wp-${rule.id}`,
      label: rule.campaignName ?? rule.clientDisplayName ?? "Rule",
      status: complete ? "verified" : hasWorkflow || hasPipeline ? "warning" : "needs_setup",
      detail: complete
        ? "Workflow and pipeline/stage configured"
        : hasWorkflow
          ? "Workflow set — pipeline/stage incomplete"
          : "Workflow/pipeline not fully configured",
      source: "live",
      adminOnly: false,
      adminDetail: `workflow=${rule.destinationWorkflowIdGhl ?? "—"} pipeline=${rule.destinationPipelineIdGhl ?? "—"}`,
    };
  });

  return {
    key: "workflow_pipeline_config",
    label: "Workflow / Pipeline Config",
    status: worstTrustStatus(checks.map((c) => c.status)),
    headline: "Pipeline and workflow completeness across routing rules",
    lastCheckedAt: now,
    checks,
    source: "live",
  };
}

export function buildWebhookHealthCard(
  metrics: AdminMetricsSummary | null,
  signal: AutomationSignalHealth | null,
  now: string
): TrustCheckCard | null {
  if (!metrics && !signal) return null;
  const checks: TrustCheckDetail[] = [];
  if (metrics) {
    const failRate =
      metrics.webhookRequestsTotal > 0
        ? metrics.webhookFailures / metrics.webhookRequestsTotal
        : 0;
    checks.push({
      id: "wh-receipt",
      label: "Inbound webhook receipt",
      status: metrics.webhookRequestsToday > 0 ? "verified" : "warning",
      detail: `${metrics.webhookRequestsToday} received today`,
      source: "live",
    });
    checks.push({
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
      source: "live",
    });
    checks.push({
      id: "wh-failures",
      label: "Failure rate",
      status: failRate > 0.05 ? "failed" : failRate > 0 ? "warning" : "verified",
      detail: `${metrics.webhookFailures} failures of ${metrics.webhookRequestsTotal} total`,
      source: "live",
      adminOnly: true,
      adminDetail: `Validation failures: ${metrics.webhookValidationFailures}`,
    });
  }
  if (signal) {
    checks.push({
      id: "wh-validation",
      label: "Validation failures",
      status: signal.validationFailures > 0 ? "warning" : "verified",
      detail:
        signal.validationFailures > 0
          ? `${signal.validationFailures} validation failure(s) in range`
          : "No validation failures in range",
      source: "live",
    });
  }
  if (!checks.length) return null;

  return {
    key: "webhook_health",
    label: "Webhook Health",
    status: worstTrustStatus(checks.map((c) => c.status)),
    headline: metrics?.latestWebhookAt
      ? `Last webhook ${new Date(metrics.latestWebhookAt).toLocaleString()}`
      : "Webhook pipeline monitored",
    lastCheckedAt: metrics?.latestWebhookAt ?? now,
    checks,
    source: "live",
  };
}

export function buildRoutingRuleReadinessCard(
  rules: RoutingRuleWithReadinessItem[],
  now: string
): TrustCheckCard | null {
  if (!rules.length) return null;
  const active = rules.filter((r) => r.active).length;
  const checks: TrustCheckDetail[] = [
    {
      id: "rr-active",
      label: "Active rules",
      status: active > 0 ? "verified" : "needs_setup",
      detail: `${active} of ${rules.length} rules active`,
      source: "live",
    },
    {
      id: "rr-readiness",
      label: "Readiness checks",
      status: rules.some((r) => r.readiness.blockers.length)
        ? "warning"
        : "verified",
      detail: rules.some((r) => r.readiness.blockers.length)
        ? `${rules.filter((r) => r.readiness.blockers.length).length} rule(s) with blockers`
        : "All active rules pass readiness checks",
      source: "live",
    },
    {
      id: "rr-fallback",
      label: "Fallback routing",
      status: rules.some((r) => r.backupSheetEnabled || r.deliveryMode === "shadow")
        ? "verified"
        : "warning",
      detail: "Shadow/backup routing configured where required",
      source: "live",
    },
  ];

  return {
    key: "routing_rule_readiness",
    label: "Routing Rule Readiness",
    status: worstTrustStatus(checks.map((c) => c.status)),
    headline: `${active} active routing rules monitored`,
    lastCheckedAt: now,
    checks,
    source: "live",
  };
}

export function buildSignalHealthCard(
  signal: AutomationSignalHealth | null,
  now: string
): TrustCheckCard | null {
  if (!signal) return null;
  const checks: TrustCheckDetail[] = [
    {
      id: "sig-sent",
      label: "Signals sent",
      status: signal.signalSent > 0 ? "verified" : "warning",
      detail: `${signal.signalSent} signal(s) sent in range`,
      source: "live",
    },
    {
      id: "sig-failed",
      label: "Signal failures",
      status: signal.signalFailed > 0 ? "warning" : "verified",
      detail:
        signal.signalFailed > 0
          ? `${signal.signalFailed} failure(s) in range`
          : "No signal failures in range",
      source: "live",
    },
    {
      id: "sig-webhook",
      label: "Webhook failures (signal path)",
      status: signal.webhookFailures > 0 ? "warning" : "verified",
      detail: `${signal.webhookFailures} webhook failure(s) affecting signals`,
      source: "live",
      adminOnly: true,
    },
  ];

  return {
    key: "signal_health",
    label: "Signal Health",
    status: worstTrustStatus(checks.map((c) => c.status)),
    headline: signal.lastSuccessfulSignalAt
      ? `Last successful signal ${new Date(signal.lastSuccessfulSignalAt).toLocaleString()}`
      : "Automation signal health summary",
    lastCheckedAt: signal.lastSuccessfulSignalAt ?? now,
    checks,
    source: "live",
  };
}

export function buildClientSnapshotCard(
  rules: RoutingRuleWithReadinessItem[],
  now: string
): TrustCheckCard | null {
  if (!rules.length) return null;
  const checks: TrustCheckDetail[] = [
    {
      id: "snap-pipeline",
      label: "Pipeline snapshot",
      status: rules.every((r) => r.snapshotInstalled) ? "verified" : "needs_setup",
      detail: `${rules.filter((r) => r.snapshotInstalled).length}/${rules.length} rules with snapshot installed`,
      source: "live",
    },
    {
      id: "snap-fields",
      label: "Custom fields sync",
      status: rules.every((r) => r.requiredFieldsInstalled) ? "verified" : "warning",
      detail: "Required CRM fields installed on destinations",
      source: "live",
    },
    {
      id: "snap-tags",
      label: "Config completeness",
      status: rules.some((r) => r.readiness.warnings.length) ? "warning" : "verified",
      detail: rules.some((r) => r.readiness.warnings.length)
        ? `${rules.filter((r) => r.readiness.warnings.length).length} rule(s) with config warnings`
        : "No config warnings on active rules",
      source: "live",
      adminOnly: true,
    },
  ];

  return {
    key: "client_snapshot_readiness",
    label: "Client Snapshot Readiness",
    status: worstTrustStatus(checks.map((c) => c.status)),
    headline: "CRM snapshot and field readiness for active clients",
    lastCheckedAt: now,
    checks,
    source: "live",
  };
}
