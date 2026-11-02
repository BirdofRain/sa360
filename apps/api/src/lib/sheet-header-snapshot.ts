import { createHash } from "node:crypto";

/**
 * Literal worksheet headers.
 *
 * Column position is the array index. An empty Google header is stored as "".
 * A header whose only character is U+200B stays that character. It is not
 * treated as blank and it is not rewritten.
 */
export function persistHeaderSnapshot(header: readonly string[]): string[] {
  return header.map((cell) => cell);
}

export function readHeaderSnapshot(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item : ""));
}

export function headerFingerprint(header: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify([...header])).digest("hex");
}

export function exactHeader(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((cell, index) => (actual[index] ?? "") === cell);
}
