/**
 * Effective global GHL runtime gates.
 *
 * The effective mode is DeliveryRuntimeModeSetting, capped by
 * GHL_DELIVERY_ADAPTER_MAX_MODE and SA360_GHL_LIVE_CANARY_ALLOWED.
 * isGhlLiveCanaryWriteAllowed() is true only when that effective mode is
 * live_canary. Setting live_canary does not enable Sheets and does not send
 * for a destination that has not been activated.
 *
 * Paths that become able to write when the effective mode is live_canary,
 * and the extra gate each one still requires:
 *
 * - Ongoing association drain. A pending OngoingGhlDispatchIntent recorded
 *   with intake, a destination whose activation snapshot still matches, and
 *   resolvedAt >= ongoingDeliveryNotBefore. It does not read the direct
 *   allowlist, SA360_LIVE_CANARY_ALLOWED_DESTINATIONS, the NextGen approval
 *   gate, DELIVER ONE LEAD, or SA360_GHL_SINGLE_PLAN_CANARY_ID.
 * - POST /admin/v1/delivery-plans/:id/ghl-live/canary. DELIVER ONE LEAD and a
 *   prior simulation.
 * - POST /admin/v1/source-leads/:id/approve-delivery. APPROVE SOURCE LEAD
 *   DELIVERY, the direct allowlist, and the NextGen gate when the source is
 *   leadcapture_io_nextgen.
 * - POST /admin/v1/lead-delivery/direct-demo and bulk live. Direct allowlist.
 *   An empty direct allowlist is the demo client, not unrestricted.
 * - Fulfillment deliverLive. LF2 allowlists. Empty denies.
 *
 * Sheets execution stays on SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED and
 * the per-client campaignDispatchEnabled flag. An unset
 * SA360_LIVE_CANARY_ALLOWED_DESTINATIONS does not authorize a destination.
 */

export const DELIVERY_RUNTIME_GATES = {
  effectiveModeSource: "DeliveryRuntimeModeSetting",
  liveWriteRequiresEffectiveMode: "live_canary",
  ceilingEnv: ["GHL_DELIVERY_ADAPTER_MAX_MODE", "SA360_GHL_LIVE_CANARY_ALLOWED"],
  pathsEnabledWhenLiveCanary: [
    {
      id: "ongoing_association_drain",
      alsoRequires: [
        "OngoingGhlDispatchIntent recorded with intake",
        "destination activation snapshot still matches",
        "event resolvedAt >= ongoingDeliveryNotBefore",
      ],
      doesNotUse: [
        "SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS",
        "SA360_LIVE_CANARY_ALLOWED_DESTINATIONS",
        "DELIVER ONE LEAD",
        "APPROVE SOURCE LEAD DELIVERY",
        "SA360_GHL_SINGLE_PLAN_CANARY_ID",
        "SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED",
      ],
    },
    {
      id: "one_lead_canary",
      alsoRequires: ["DELIVER ONE LEAD", "prior simulation"],
    },
    {
      id: "approve_source_lead",
      alsoRequires: [
        "APPROVE SOURCE LEAD DELIVERY",
        "direct allowlist",
        "NextGen gate when the source is leadcapture_io_nextgen",
      ],
    },
    {
      id: "direct_demo_and_bulk_live",
      alsoRequires: ["direct allowlist"],
    },
    {
      id: "fulfillment_deliver_live",
      alsoRequires: ["LF2 allowlists", "deny by default when unset"],
    },
  ],
  unchangedByLiveCanary: [
    "SA360_COMPANY_GOOGLE_SHEETS_ENABLED",
    "SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED",
    "SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED",
    "per-client campaignDispatchEnabled",
  ],
} as const;

export function liveCanaryEnablesOngoingDrain(): boolean {
  const path = DELIVERY_RUNTIME_GATES.pathsEnabledWhenLiveCanary.find(
    (row) => row.id === "ongoing_association_drain"
  );
  return Boolean(path && "doesNotUse" in path);
}
