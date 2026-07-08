const SECRET_KEY_PATTERN =
  /token|secret|password|apikey|api_key|authorization|credential|privatekey|private_key|oauth|bearer|refresh/i;

function isSecretKey(key: string): boolean {
  if (/(RefId|Ref|_ref)$/i.test(key)) return false;
  return SECRET_KEY_PATTERN.test(key);
}

/** Recursively strip secret-like keys from attempt snapshots. */
export function sanitizeAttemptPayload(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return { items: value.map((item) => sanitizeAttemptPayload(item) ?? null) };
  }
  if (typeof value !== "object") {
    return { value };
  }

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(key)) continue;
    if (Array.isArray(nested)) {
      out[key] = nested.map((item) => sanitizeAttemptPayload(item) ?? null);
      continue;
    }
    if (typeof nested === "object" && nested !== null) {
      out[key] = sanitizeAttemptPayload(nested);
      continue;
    }
    if (typeof nested === "string" && nested.length > 2_000) {
      out[key] = `${nested.slice(0, 200)}…`;
      continue;
    }
    out[key] = nested;
  }
  return out;
}

export function containsPersistedSecret(value: unknown): string[] {
  const hits: string[] = [];
  function walk(node: unknown, path: string): void {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (typeof node !== "object") return;
    for (const [key, nested] of Object.entries(node as Record<string, unknown>)) {
      const next = path ? `${path}.${key}` : key;
      if (isSecretKey(key)) hits.push(next);
      walk(nested, next);
    }
  }
  walk(value, "");
  return hits;
}

export function fingerprintPayload(value: unknown): string {
  const sanitized = sanitizeAttemptPayload(value);
  return JSON.stringify(sanitized ?? {});
}
