import type { GhlDiscoveredPipeline, GhlDiscoveredPipelineStage } from "./types";

export function stagesForPipeline(
  pipelines: GhlDiscoveredPipeline[],
  pipelineId: string
): GhlDiscoveredPipelineStage[] {
  const pipe = pipelines.find((p) => p.id === pipelineId);
  return pipe?.stages ?? [];
}

export function labelById<T extends { id: string; name: string }>(
  items: T[],
  id: string | null | undefined
): string | null {
  if (!id) return null;
  const hit = items.find((x) => x.id === id);
  return hit?.name ?? null;
}

const GHL_DESTINATION_CONFIG_KEYS = [
  "destinationWorkflowIdGhl",
  "destinationPipelineIdGhl",
  "destinationPipelineStageIdGhl",
] as const;

export function hasGhlDeliveryConfigMissing(missingConfig: string[]): boolean {
  return missingConfig.some((k) => (GHL_DESTINATION_CONFIG_KEYS as readonly string[]).includes(k));
}

/** Inline operator message when delivery readiness reports missing GHL config fields. */
export function formatGhlMissingConfigInlineMessage(missingConfig: string[]): string | null {
  const keys = missingConfig.filter((k) => typeof k === "string" && k.trim());
  if (keys.length === 0) return null;
  return `Delivery config incomplete — missing: ${keys.join(", ")}`;
}
