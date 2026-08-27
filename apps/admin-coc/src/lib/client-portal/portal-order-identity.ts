/**
 * Customer-facing order identity. Canonical orderNumber is never rewritten.
 */

export function formatPortalOrderIdentity(
  displayName: string | null | undefined,
  orderNumber: string
): string {
  const name = typeof displayName === "string" ? displayName.trim() : "";
  const number = typeof orderNumber === "string" ? orderNumber.trim() : "";
  if (!number) return name;
  if (!name || name === number) return number;
  return `${name} — ${number}`;
}
