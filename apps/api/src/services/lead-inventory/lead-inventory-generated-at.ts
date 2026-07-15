import type { SourceLeadEvent } from "@prisma/client";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function firstDate(...values: unknown[]): Date | null {
  for (const value of values) {
    const parsed = readDate(value);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Resolve authoritative generatedAt from provider/source timestamps.
 * receivedAt is intentionally not used as a silent fallback.
 */
export function resolveInventoryGeneratedAt(event: Pick<SourceLeadEvent, "normalizedPayloadJson" | "enrichmentMetadataJson" | "receivedAt">): {
  generatedAt: Date | null;
  source: string | null;
} {
  const normalized = asRecord(event.normalizedPayloadJson);
  const enrichment = asRecord(event.enrichmentMetadataJson);
  const contact = normalized ? asRecord(normalized.contact) : null;
  const eventMeta = normalized ? asRecord(normalized.event) : null;
  const sourceAttrs = enrichment ? asRecord(enrichment.sourceAttributes) : null;

  const candidates: Array<{ value: Date | null; source: string }> = [
    {
      value: firstDate(
        normalized?.generated_at,
        normalized?.generatedAt,
        normalized?.submitted_at,
        normalized?.submittedAt,
        contact?.generated_at,
        contact?.generatedAt,
        eventMeta?.generated_at,
        eventMeta?.submitted_at
      ),
      source: "normalized_payload",
    },
    {
      value: firstDate(
        sourceAttrs?.generated_at,
        sourceAttrs?.generatedAt,
        sourceAttrs?.provider_submitted_at,
        enrichment?.generatedAt
      ),
      source: "enrichment_metadata",
    },
  ];

  for (const candidate of candidates) {
    if (candidate.value) {
      return { generatedAt: candidate.value, source: candidate.source };
    }
  }

  return { generatedAt: null, source: null };
}
