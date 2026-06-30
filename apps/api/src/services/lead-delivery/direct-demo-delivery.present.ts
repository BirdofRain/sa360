import type { DuplicateRiskAssessmentItem } from "../lead-identity/lead-identity.types.js";

export type DirectDemoSourceLane = "meta_lead_ads" | "leadcapture_io" | "manual_direct_demo" | "unknown";

export const DUPLICATE_RISK_SHADOW_REVIEW_MESSAGE =
  "No duplicate risk detected — safe to continue shadow delivery review.";

export const DUPLICATE_RISK_DIRECT_CANARY_REVIEW_MESSAGE =
  "No duplicate risk detected — safe to continue direct canary review.";

export const DIRECT_DEMO_LIVE_CANARY_SUCCESS_SUMMARY =
  "Live canary delivery completed successfully.";

const SOURCE_LANE_LABELS: Record<DirectDemoSourceLane, string> = {
  meta_lead_ads: "Meta Lead Ads",
  leadcapture_io: "LeadCapture.io",
  manual_direct_demo: "Manual direct demo",
  unknown: "Unknown",
};

function normalizeToken(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readSourceToken(
  root: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  const attribution = isObject(root.attribution) ? root.attribution : null;
  const routing = isObject(root.routing) ? root.routing : null;
  const sourceIntake = routing && isObject(routing.source_intake) ? routing.source_intake : null;
  const sourceAttributes =
    sourceIntake && isObject(sourceIntake.sourceAttributes) ? sourceIntake.sourceAttributes : null;

  for (const key of keys) {
    const direct = readString(attribution?.[key]);
    if (direct) return direct;
    const preserved = readString(sourceAttributes?.[key]);
    if (preserved) return preserved;
  }

  return null;
}

export function inferDirectDemoSourceLane(payload: unknown): {
  sourceLane: DirectDemoSourceLane;
  sourceLaneLabel: string;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { sourceLane: "unknown", sourceLaneLabel: SOURCE_LANE_LABELS.unknown };
  }

  const root = payload as Record<string, unknown>;
  const platform = normalizeToken(
    readSourceToken(root, ["source_platform", "sourcePlatform"])
  );
  const sourceType = normalizeToken(readSourceToken(root, ["source_type", "sourceType"]));
  const eventName = normalizeToken(
    typeof root.event === "object" && root.event && !Array.isArray(root.event)
      ? String((root.event as Record<string, unknown>).event_name_internal ?? "")
      : ""
  );
  const leadUid = normalizeToken(
    typeof root.contact === "object" && root.contact && !Array.isArray(root.contact)
      ? String((root.contact as Record<string, unknown>).lead_uid ?? "")
      : ""
  );

  if (
    platform === "leadcapture.io" ||
    platform === "leadcapture_io" ||
    sourceType === "leadcapture_io" ||
    sourceType === "landing_page_form"
  ) {
    return {
      sourceLane: "leadcapture_io",
      sourceLaneLabel: SOURCE_LANE_LABELS.leadcapture_io,
    };
  }

  if (
    platform === "facebook" &&
    (sourceType === "facebook_lead_form" || sourceType.includes("lead_form"))
  ) {
    return {
      sourceLane: "meta_lead_ads",
      sourceLaneLabel: SOURCE_LANE_LABELS.meta_lead_ads,
    };
  }

  if (eventName === "lead_created" && platform === "facebook") {
    return {
      sourceLane: "meta_lead_ads",
      sourceLaneLabel: SOURCE_LANE_LABELS.meta_lead_ads,
    };
  }

  if (
    platform === "direct_delivery_demo" ||
    sourceType === "direct_delivery_demo" ||
    leadUid.includes("demo_sa360_direct")
  ) {
    return {
      sourceLane: "manual_direct_demo",
      sourceLaneLabel: SOURCE_LANE_LABELS.manual_direct_demo,
    };
  }

  return { sourceLane: "unknown", sourceLaneLabel: SOURCE_LANE_LABELS.unknown };
}

export function recommendedActionForDirectDemo(
  recommendedAction: string | null | undefined
): string | null {
  if (!recommendedAction?.trim()) return null;
  if (
    recommendedAction === DUPLICATE_RISK_SHADOW_REVIEW_MESSAGE ||
    recommendedAction.includes("shadow delivery review")
  ) {
    return recommendedAction.replace("shadow delivery review", "direct canary review");
  }
  return recommendedAction;
}

export function presentDuplicateRiskForDirectDemo(
  duplicateRisk: DuplicateRiskAssessmentItem | null
): DuplicateRiskAssessmentItem | null {
  if (!duplicateRisk) return null;
  const recommendedAction = recommendedActionForDirectDemo(duplicateRisk.recommendedAction);
  if (!recommendedAction || recommendedAction === duplicateRisk.recommendedAction) return duplicateRisk;
  return { ...duplicateRisk, recommendedAction };
}
