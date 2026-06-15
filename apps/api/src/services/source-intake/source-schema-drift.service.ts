import { prisma } from "../../lib/db.js";
import {
  DEFAULT_SOURCE_FIELD_ALIASES,
  normalizeSourceFieldKey,
  resolveCanonicalAttributeKey,
} from "./source-field-alias.registry.js";
import { computeSchemaFingerprint } from "./source-attribute-extractor.service.js";
import type { SourceSchemaDrift, SourceSchemaStatus } from "./source-enrichment.types.js";

function detectPossibleRenames(
  added: string[],
  removed: string[],
  routeAliasOverrides?: Record<string, readonly string[]>
): SourceSchemaDrift["possibleRenames"] {
  const renames: SourceSchemaDrift["possibleRenames"] = [];
  for (const removedKey of removed) {
    const removedCanonical = resolveCanonicalAttributeKey(removedKey, routeAliasOverrides);
    if (!removedCanonical) continue;
    for (const addedKey of added) {
      const addedCanonical = resolveCanonicalAttributeKey(addedKey, routeAliasOverrides);
      if (addedCanonical === removedCanonical) {
        renames.push({ from: removedKey, to: addedKey, canonical: removedCanonical });
      }
    }
  }
  return renames;
}

function buildSchemaWarnings(
  added: string[],
  removed: string[],
  possibleRenames: SourceSchemaDrift["possibleRenames"]
): string[] {
  const warnings: string[] = [];
  for (const key of added) {
    warnings.push(`New source field detected: ${key}`);
  }
  for (const key of removed) {
    const renamed = possibleRenames.find((r) => r.from === key);
    if (renamed) {
      warnings.push(`Possible rename: ${renamed.from} → ${renamed.to}`);
    } else {
      warnings.push(`Previously mapped field missing: ${key}`);
    }
  }
  return warnings;
}

export async function detectSourceSchemaDrift(input: {
  sourceProvider: string;
  sourceRouteKey: string;
  incomingAnswerKeys: string[];
  routeAliasOverrides?: Record<string, readonly string[]>;
}): Promise<{ sourceSchemaStatus: SourceSchemaStatus; schemaDrift: SourceSchemaDrift }> {
  const routeKey = input.sourceRouteKey.trim() || "UNKNOWN_ROUTE";
  const normalizedIncoming = input.incomingAnswerKeys.map(normalizeSourceFieldKey).filter(Boolean);
  const schemaFingerprint = computeSchemaFingerprint(normalizedIncoming);

  const prior = await prisma.sourceRouteSchemaSnapshot.findUnique({
    where: {
      sourceProvider_sourceRouteKey: {
        sourceProvider: input.sourceProvider,
        sourceRouteKey: routeKey,
      },
    },
  });

  const priorKeys = prior
    ? (prior.fieldKeysJson as string[])
    : [];
  const priorNormalized = new Set(priorKeys.map(normalizeSourceFieldKey));
  const incomingNormalized = new Set(normalizedIncoming);

  const addedFields = normalizedIncoming.filter((k) => !priorNormalized.has(k));
  const removedFields = [...priorNormalized].filter((k) => !incomingNormalized.has(k));

  const addedOriginal = input.incomingAnswerKeys.filter(
    (k) => !priorKeys.map(normalizeSourceFieldKey).includes(normalizeSourceFieldKey(k))
  );
  const removedOriginal = priorKeys.filter(
    (k) => !normalizedIncoming.includes(normalizeSourceFieldKey(k))
  );

  const possibleRenames = detectPossibleRenames(
    addedOriginal,
    removedOriginal,
    input.routeAliasOverrides
  );
  const warnings = buildSchemaWarnings(addedOriginal, removedOriginal, possibleRenames);

  let sourceSchemaStatus: SourceSchemaStatus;
  if (!prior) {
    sourceSchemaStatus = "first_seen";
  } else if (addedFields.length > 0 || removedFields.length > 0) {
    sourceSchemaStatus = "changed";
  } else {
    sourceSchemaStatus = "known";
  }

  await prisma.sourceRouteSchemaSnapshot.upsert({
    where: {
      sourceProvider_sourceRouteKey: {
        sourceProvider: input.sourceProvider,
        sourceRouteKey: routeKey,
      },
    },
    create: {
      sourceProvider: input.sourceProvider,
      sourceRouteKey: routeKey,
      fieldKeysJson: input.incomingAnswerKeys,
      schemaFingerprint,
    },
    update: {
      fieldKeysJson: input.incomingAnswerKeys,
      schemaFingerprint,
      lastSeenAt: new Date(),
    },
  });

  return {
    sourceSchemaStatus,
    schemaDrift: {
      addedFields: addedOriginal,
      removedFields: removedOriginal,
      possibleRenames,
      schemaFingerprint,
      warnings,
    },
  };
}

/** Suggest canonical mapping for an unknown field key (admin C.O.C. only — not used for auto-match). */
export function suggestCanonicalForUnknownField(
  sourceKey: string
): { canonical: string; confidence: "alias" | "normalized" } | null {
  const canonical = resolveCanonicalAttributeKey(sourceKey);
  if (canonical) return { canonical, confidence: "alias" };
  const normalized = normalizeSourceFieldKey(sourceKey);
  for (const [key, aliases] of Object.entries(DEFAULT_SOURCE_FIELD_ALIASES)) {
    if (aliases.some((a) => normalizeSourceFieldKey(a) === normalized)) {
      return { canonical: key, confidence: "normalized" };
    }
  }
  return null;
}
