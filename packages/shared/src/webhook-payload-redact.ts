/**
 * Redacts webhook JSON bodies before persistence or admin display.
 * Deep-clones plain JSON shapes only; strips obvious secret-bearing keys and caps size.
 */

const MAX_DEPTH = 24;
const MAX_STRING_CHARS = 4096;
const MAX_JSON_OUTPUT_BYTES = 64 * 1024;

/** Keys matching any segment (snake_case / camelCase) are replaced. */
const SENSITIVE_KEY_PATTERN =
  /^(?:.*_)?(?:secret|token|password|apikey|api_key|apikeyid|auth|authorization|bearer|access_token|refresh_token|credential|credentials|private_key|client_secret|webhook_secret|meta_access_token|metaaccesstoken|private_integration_token|ghl_private)(?:_.*)?$/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function truncateString(s: string): string {
  if (s.length <= MAX_STRING_CHARS) return s;
  return `${s.slice(0, MAX_STRING_CHARS)}…[truncated:${s.length}]`;
}

function looksLikeBearerToken(value: string): boolean {
  const t = value.trim();
  return /^bearer\s+\S+/i.test(t) && t.length > 12;
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    return "[max-depth]";
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    const t = truncateString(value);
    if (looksLikeBearerToken(t)) {
      return "[redacted:bearer]";
    }
    return t;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }
  if (typeof value === "object") {
    if (value instanceof Date) {
      return value.toISOString();
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) {
      return "[non-plain-object]";
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        out[k] = "***REDACTED***";
      } else {
        out[k] = redactValue(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

/**
 * Returns a JSON-serializable structure safe to store in Prisma `Json`.
 * On oversize after redaction, returns a small stub instead of the payload.
 */
export function redactWebhookPayloadForLog(input: unknown): unknown {
  try {
    const redacted = redactValue(input, 0);
    const s = JSON.stringify(redacted);
    const approxUtf8Bytes = new TextEncoder().encode(s).length;
    if (approxUtf8Bytes > MAX_JSON_OUTPUT_BYTES) {
      return {
        _sa360_redaction: "oversized",
        approxUtf8Bytes,
      };
    }
    return JSON.parse(s) as unknown;
  } catch {
    return { _sa360_redaction: "unserializable" };
  }
}
