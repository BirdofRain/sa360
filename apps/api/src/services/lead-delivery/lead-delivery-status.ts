import type { SourceLeadEventStatus } from "@prisma/client";

export type NormalizedRoutingStatus =
  | "unmatched"
  | "matched"
  | "review_required"
  | "dry_run"
  | "ready"
  | "failed"
  | "unknown";

export type NormalizedDeliveryStatus =
  | "not_started"
  | "simulated"
  | "pending"
  | "delivered"
  | "partial"
  | "failed"
  | "skipped"
  | "unknown";

export type NormalizedGhlContactStatus =
  | "not_created"
  | "created"
  | "updated"
  | "linked"
  | "unknown";

type RoutingInput = {
  sourceStatus: SourceLeadEventStatus;
  matched?: boolean | null;
  routingRuleId?: string | null;
  validationStatus?: string | null;
  deliveryMode?: string | null;
  planStatus?: string | null;
};

type DeliveryInput = {
  sourceStatus: SourceLeadEventStatus;
  deliveryMode?: string | null;
  planStatus?: string | null;
  adapterRunStatus?: string | null;
  liveRunStatus?: string | null;
  deliveryResultStatus?: string | null;
  hasContactId?: boolean;
};

export function normalizeRoutingStatus(input: RoutingInput): NormalizedRoutingStatus {
  const status = input.sourceStatus;
  if (status === "routing_unmatched") return "unmatched";
  if (status === "needs_review" || status === "duplicate_blocked") return "review_required";
  if (input.validationStatus === "mismatch" || input.validationStatus === "needs_mapping") {
    return "review_required";
  }
  if (input.matched === true || status === "routing_matched") {
    if (input.deliveryMode === "dry_run" || input.planStatus === "dry_run") return "dry_run";
    if (input.planStatus === "ready" || input.planStatus === "planned") return "ready";
    return "matched";
  }
  if (input.matched === false) return "unmatched";
  if (status === "delivery_failed" || status === "rejected") return "failed";
  return "unknown";
}

export function normalizeDeliveryStatus(input: DeliveryInput): NormalizedDeliveryStatus {
  const status = input.sourceStatus;
  if (status === "routing_unmatched" || status === "duplicate_blocked") return "skipped";
  if (status === "rejected") return "skipped";
  if (status === "delivered") return "delivered";
  if (status === "delivery_failed") return "failed";

  const mode = input.deliveryMode?.toLowerCase() ?? "";
  const adapter = input.adapterRunStatus?.toLowerCase() ?? "";
  const live = input.liveRunStatus?.toLowerCase() ?? "";

  if (mode.includes("simulate") || adapter === "simulated" || adapter === "completed_simulation") {
    return "simulated";
  }
  if (live === "partial" || adapter === "partial") return "partial";
  if (live === "completed" || live === "succeeded" || input.hasContactId) {
    if (status === "approved") return "pending";
    return "delivered";
  }
  if (status === "approved") return "pending";
  if (status === "received" || status === "normalized") return "not_started";
  if (status === "routing_matched" || status === "needs_review") return "not_started";

  const result = input.deliveryResultStatus?.toLowerCase() ?? "";
  if (result.includes("simul")) return "simulated";
  if (result.includes("fail")) return "failed";
  if (result.includes("deliver")) return "delivered";

  return "unknown";
}

export function normalizeGhlContactStatus(input: {
  contactIdGhl?: string | null;
  deliveryResultContactStatus?: string | null;
  liveRunContactCreated?: boolean | null;
}): NormalizedGhlContactStatus {
  if (input.contactIdGhl?.trim()) {
    const raw = input.deliveryResultContactStatus?.toLowerCase() ?? "";
    if (raw.includes("update")) return "updated";
    if (raw.includes("link")) return "linked";
    if (input.liveRunContactCreated === true || raw.includes("create")) return "created";
    return "created";
  }
  if (input.deliveryResultContactStatus?.toLowerCase().includes("not")) return "not_created";
  return "not_created";
}
