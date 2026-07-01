import type { TrustCenterResponse } from "../types";

/** Mock trust cards — fallback when live endpoints are unavailable. */
export function getMockTrustCenter(
  role: "admin" | "client" | "agent" = "admin"
): TrustCenterResponse {
  const now = new Date().toISOString();
  const cards: TrustCenterResponse["cards"] = [
    {
      key: "ghl_connection",
      label: "GHL Connection",
      status: "mock",
      headline: "Preview — GHL connection status",
      lastCheckedAt: now,
      source: "mock",
      checks: [
        { id: "ghl-1", label: "OAuth token valid", status: "mock", detail: "Preview data", source: "mock" },
        { id: "ghl-2", label: "Location sync", status: "mock", detail: "Preview data", source: "mock" },
      ],
    },
    {
      key: "delivery_readiness",
      label: "Delivery Readiness",
      status: "mock",
      headline: "Preview — delivery readiness summary",
      lastCheckedAt: now,
      source: "mock",
      checks: [
        { id: "dr-1", label: "Live delivery readiness", status: "mock", detail: "Preview data", source: "mock" },
      ],
    },
    {
      key: "required_fields",
      label: "Required Fields",
      status: "mock",
      headline: "Preview — required field mapping status",
      lastCheckedAt: now,
      source: "mock",
      checks: [
        { id: "rf-1", label: "Core required fields", status: "mock", detail: "Preview data", source: "mock" },
      ],
    },
    {
      key: "workflow_pipeline_config",
      label: "Workflow / Pipeline Config",
      status: "mock",
      headline: "Preview — workflow and pipeline completeness",
      lastCheckedAt: now,
      source: "mock",
      checks: [
        { id: "wp-1", label: "Workflow configured", status: "mock", detail: "Preview data", source: "mock" },
      ],
    },
    {
      key: "webhook_health",
      label: "Webhook Health",
      status: "mock",
      headline: role === "client" ? "Preview — lifecycle feed healthy" : "Preview — webhook health summary",
      lastCheckedAt: now,
      source: "mock",
      checks: [
        { id: "wh-1", label: "Inbound webhook receipt", status: "mock", detail: "Preview data", source: "mock" },
        { id: "wh-2", label: "Processing latency", status: "mock", detail: "Preview data", source: "mock" },
      ],
    },
    {
      key: "routing_rule_readiness",
      label: "Routing Rule Readiness",
      status: "mock",
      headline: "Preview — routing rule readiness",
      lastCheckedAt: now,
      source: "mock",
      checks: [
        { id: "rr-1", label: "Active rules", status: "mock", detail: "Preview data", source: "mock" },
      ],
    },
    {
      key: "signal_health",
      label: "Signal Health",
      status: "mock",
      headline: "Preview — automation signal health",
      lastCheckedAt: now,
      source: "mock",
      checks: [
        { id: "sig-1", label: "Signals sent", status: "mock", detail: "Preview data", source: "mock" },
      ],
    },
    {
      key: "client_snapshot_readiness",
      label: "Client Snapshot Readiness",
      status: "mock",
      headline: "Preview — CRM snapshot readiness",
      lastCheckedAt: now,
      source: "mock",
      checks: [
        { id: "snap-1", label: "Pipeline snapshot", status: "mock", detail: "Preview data", source: "mock" },
      ],
    },
  ];

  return { cards, dataSource: "mock" };
}
