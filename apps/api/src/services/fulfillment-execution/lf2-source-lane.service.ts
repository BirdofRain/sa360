import type { SourceLeadEvent } from "@prisma/client";

export type SourceLaneInput = Pick<
  SourceLeadEvent,
  "sourceProvider" | "sourceSystem" | "enrichmentMetadataJson"
>;

/** Same canonical lane resolution used by shadow eligibility and matcher. */
export function resolveCanonicalSourceLane(event: SourceLaneInput): string {
  const enrichment =
    event.enrichmentMetadataJson && typeof event.enrichmentMetadataJson === "object"
      ? (event.enrichmentMetadataJson as Record<string, unknown>)
      : {};
  const lane =
    typeof enrichment.sourceLane === "string"
      ? enrichment.sourceLane
      : `${event.sourceProvider}_${event.sourceSystem}`;
  return lane.trim().toLowerCase();
}
