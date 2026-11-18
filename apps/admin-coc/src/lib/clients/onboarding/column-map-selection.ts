import type { ColumnMapRecord } from "./types";

/**
 * The editor shows the newest map for the selected worksheet.
 * An older unresolved draft does not hide a later draft or a published map.
 * Delivery keeps using the published map. A draft is "unpublished" only when
 * its version is newer than that published map.
 */
export function splitColumnMaps(
  maps: ColumnMapRecord[],
  spreadsheetId: string | null,
  worksheetId: number | null
): { editor: ColumnMapRecord | null; delivery: ColumnMapRecord | null; unpublished: ColumnMapRecord | null } {
  const active = maps.filter((map) => map.status === "draft" || map.status === "published");
  const matched =
    spreadsheetId && worksheetId != null
      ? active.filter((map) => map.spreadsheetId === spreadsheetId && map.worksheetId === worksheetId)
      : active;
  const ranked = [...matched].sort((left, right) => right.mapVersion - left.mapVersion || right.revision - left.revision);
  const delivery = ranked.find((map) => map.status === "published") ?? null;
  const newestDraft = ranked.find((map) => map.status === "draft") ?? null;
  const unpublished = newestDraft && (!delivery || newestDraft.mapVersion > delivery.mapVersion) ? newestDraft : null;
  return { editor: unpublished ?? delivery, delivery, unpublished };
}
