export type PivotComparisonRow = {
  prePivotDirection: string;
  currentDirection: string;
  status: "Changed" | "Legacy / Retainer Only" | "Deprecated / Do Not Build" | "Retained";
  notes: string;
};

export const PIVOT_COMPARISON_ROWS: PivotComparisonRow[] = [
  {
    prePivotDirection: "CRM / performance OS positioning",
    currentDirection: "Lead Fulfillment OS",
    status: "Changed",
    notes: "Strategic focus moved from CRM feature competition to proof-backed lead fulfillment.",
  },
  {
    prePivotDirection: "Module 1 intake",
    currentDirection: "LF1 Lead Intake + Proof Vault",
    status: "Changed",
    notes: "Intake now explicitly anchors proof packet and consent proof requirements.",
  },
  {
    prePivotDirection: "Smart Routing engine",
    currentDirection: "LF5 Fulfillment Matcher",
    status: "Changed",
    notes: "Routing intelligence shifts toward matching sellable inventory to paid orders.",
  },
  {
    prePivotDirection: "Agent execution / Dial Buddy concepts",
    currentDirection: "Legacy support / later reconsideration",
    status: "Legacy / Retainer Only",
    notes: "Not removed from code history; not a primary roadmap driver.",
  },
  {
    prePivotDirection: "Lifecycle automation expansion",
    currentDirection: "Retainer and existing client support",
    status: "Legacy / Retainer Only",
    notes: "Lifecycle signal engine remains for audit and outcomes visibility.",
  },
  {
    prePivotDirection: "Voice AI / Synthflow / CloseBot roadmap",
    currentDirection: "Legacy / Retainer only",
    status: "Legacy / Retainer Only",
    notes: "Existing implementations maintained without net-new roadmap expansion.",
  },
  {
    prePivotDirection: "Blue/green channel orchestration expansion",
    currentDirection: "Out of scope for new roadmap",
    status: "Deprecated / Do Not Build",
    notes: "Explicitly deprecated as a core differentiator.",
  },
  {
    prePivotDirection: "Performance dashboard emphasis",
    currentDirection: "Proof, inventory, order, fulfillment dashboards",
    status: "Changed",
    notes: "Visibility now follows fulfillment lifecycle and delivery audit requirements.",
  },
  {
    prePivotDirection: "GHL as CRM backbone identity",
    currentDirection: "GHL as downstream delivery adapter",
    status: "Changed",
    notes: "GHL remains important but no longer defines SA360 primary product identity.",
  },
];

export const PIVOT_WHAT_STAYED: string[] = [
  "GHL delivery path (guarded and manually controlled)",
  "Lifecycle event ledger / signal engine",
  "Admin C.O.C. visibility surfaces",
  "Routing and dry-run concepts",
  "Delivery readiness guardrails",
  "Client portal shell",
  "Optional Google Sheet backup/export",
];

export const PIVOT_WHAT_STOPPED: string[] = [
  "Blue/green channel selection expansion",
  "SendBlue fallback optimization as core roadmap work",
  "New Synthflow roadmap feature work",
  "New CloseBot roadmap feature work",
  "New voice AI routing/orchestration roadmap",
  "Orion-style CRM/AI front-end competition",
];

export const PIVOT_WHAT_CHANGED: string[] = [
  "From CRM feature competition to lead quality and fulfillment outcomes",
  "From AI/channel orchestration to proof-backed fulfillment controls",
  "From complex agent front-end ambitions to a simpler lead buyer dashboard",
  "From campaign routing-only framing to lead-to-paid-order fulfillment matching",
];
