import type {
  FulfillmentStatus,
  RelativeVolumeBand,
} from "./inventory-types";

export function volumeFill(band: RelativeVolumeBand): string {
  switch (band) {
    case "very_high":
      return "rgba(124, 58, 237, 0.78)";
    case "high":
      return "rgba(0, 209, 255, 0.72)";
    case "medium":
      return "rgba(0, 209, 255, 0.45)";
    case "low":
      return "rgba(0, 209, 255, 0.22)";
    case "unknown":
      return "url(#ie-hatch)";
    case "none":
    default:
      return "rgba(30, 41, 59, 0.9)";
  }
}

export function statusStroke(status: FulfillmentStatus): {
  stroke: string;
  dasharray?: string;
  width: number;
} {
  switch (status) {
    case "strong":
    case "available":
      return { stroke: "#34d399", width: 1.8 };
    case "partial":
      return { stroke: "#fbbf24", width: 1.6 };
    case "custom_review":
      return { stroke: "#a78bfa", width: 1.6 };
    case "unknown":
      return { stroke: "rgba(148, 163, 184, 0.55)", width: 1.2, dasharray: "4 3" };
    case "unavailable":
    default:
      return { stroke: "rgba(100, 116, 139, 0.45)", width: 1 };
  }
}

export function fulfillmentLabel(status: FulfillmentStatus): string {
  switch (status) {
    case "strong":
      return "Strong coverage";
    case "available":
      return "Can fulfill";
    case "partial":
      return "Partial fill";
    case "custom_review":
      return "Custom review";
    case "unknown":
      return "Inventory unknown";
    case "unavailable":
      return "No matching inventory";
  }
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatPercentRatio(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
