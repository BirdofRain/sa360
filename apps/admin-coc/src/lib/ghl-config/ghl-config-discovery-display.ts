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

export function hasGhlDeliveryConfigMissing(missingConfig: string[]): boolean {
  return missingConfig.some((k) =>
    [
      "destinationWorkflowIdGhl",
      "destinationPipelineIdGhl",
      "destinationPipelineStageIdGhl",
    ].includes(k)
  );
}
