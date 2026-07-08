const SECRET_KEY_PATTERN =
  /token|secret|password|apikey|api_key|authorization|credential|privatekey|private_key|oauth|bearer|refresh/i;

function isSecretMetadataKey(key: string): boolean {
  if (/(RefId|Ref|_ref)$/i.test(key)) return false;
  return SECRET_KEY_PATTERN.test(key);
}

export type DeliveryTargetMetadataValidationResult =
  | { ok: true }
  | { ok: false; paths: string[] };

function collectSecretPaths(value: unknown, path = ""): string[] {
  if (value === null || value === undefined) return [];

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectSecretPaths(item, `${path}[${index}]`));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const hits: string[] = [];
    for (const [key, nested] of Object.entries(record)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (isSecretMetadataKey(key)) {
        hits.push(nextPath);
      }
      hits.push(...collectSecretPaths(nested, nextPath));
    }
    return hits;
  }

  return [];
}

/** Reject secret-bearing metadata before persistence. */
export function validateDeliveryTargetMetadata(
  value: unknown
): DeliveryTargetMetadataValidationResult {
  const paths = collectSecretPaths(value);
  if (paths.length === 0) return { ok: true };
  return { ok: false, paths };
}

/** Strip secret-like keys for safe admin presentation. */
export function redactDeliveryTargetMetadataForPresentation(
  value: unknown
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretMetadataKey(key)) continue;
    if (Array.isArray(raw)) {
      out[key] = raw.map((item) =>
        typeof item === "object" && item !== null
          ? redactDeliveryTargetMetadataForPresentation(item)
          : item
      );
      continue;
    }
    if (typeof raw === "object" && raw !== null) {
      out[key] = redactDeliveryTargetMetadataForPresentation(raw);
      continue;
    }
    if (typeof raw === "string" && raw.length > 500) {
      out[key] = `${raw.slice(0, 120)}…`;
      continue;
    }
    out[key] = raw;
  }
  return out;
}
