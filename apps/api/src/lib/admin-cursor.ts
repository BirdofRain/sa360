export type CursorPayload = {
  /** ISO 8601 */
  receivedAt: string;
  id: string;
};

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | undefined): CursorPayload | null {
  if (!raw?.trim()) return null;
  try {
    const json = Buffer.from(raw.trim(), "base64url").toString("utf8");
    const parsed = JSON.parse(json) as CursorPayload;
    if (
      typeof parsed?.receivedAt !== "string" ||
      typeof parsed?.id !== "string" ||
      !parsed.receivedAt ||
      !parsed.id
    ) {
      return null;
    }
    const d = new Date(parsed.receivedAt);
    if (Number.isNaN(d.getTime())) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Keyset filter for sort order receivedAt DESC, id DESC (next page = older rows). */
export function keysetReceivedAtIdDescending(cursor: CursorPayload) {
  const d = new Date(cursor.receivedAt);
  return {
    OR: [{ receivedAt: { lt: d } }, { AND: [{ receivedAt: d }, { id: { lt: cursor.id } }] }],
  };
}
