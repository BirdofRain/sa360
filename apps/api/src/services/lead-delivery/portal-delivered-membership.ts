/**
 * Walk a tenant-scoped lead list and keep customer Delivered rows before
 * closing a page. The cursor is the last row examined, so the next page
 * continues after it. Non-members are not returned and are not visited again.
 */

export const PORTAL_DELIVERED_SCAN_BATCH = 25;
/** Hard cap on source rows examined while filling one page. */
export const PORTAL_DELIVERED_MAX_SCAN = 200;

export type PortalDeliveredScanPage<T> = {
  items: T[];
  /** Set when another row exists after `items`. The scanner does not skip to it mid-batch. */
  nextCursor: string | null;
};

export async function scanPortalDeliveredMembership<T extends { id: string }>(input: {
  pageLimit: number;
  maxScan?: number;
  batchSize?: number;
  cursor?: string;
  loadPage: (args: { limit: number; cursor?: string }) => Promise<PortalDeliveredScanPage<T>>;
  isDelivered: (row: T) => boolean;
}): Promise<{ items: T[]; nextCursor: string | null; scanned: number }> {
  const pageLimit = Math.min(Math.max(input.pageLimit, 1), 200);
  const maxScan = Math.min(Math.max(input.maxScan ?? PORTAL_DELIVERED_MAX_SCAN, 1), PORTAL_DELIVERED_MAX_SCAN);
  const batchSize = Math.min(Math.max(input.batchSize ?? PORTAL_DELIVERED_SCAN_BATCH, 1), PORTAL_DELIVERED_SCAN_BATCH);
  const collected: T[] = [];
  let scanned = 0;
  let cursor = input.cursor;

  while (collected.length < pageLimit && scanned < maxScan) {
    const page = await input.loadPage({
      limit: Math.min(batchSize, maxScan - scanned),
      cursor,
    });
    if (page.items.length === 0) break;

    for (let index = 0; index < page.items.length; index += 1) {
      const row = page.items[index]!;
      scanned += 1;
      cursor = row.id;
      if (input.isDelivered(row)) collected.push(row);
      const pageFull = collected.length >= pageLimit;
      const budgetSpent = scanned >= maxScan;
      if (pageFull || budgetSpent) {
        const more = index < page.items.length - 1 || Boolean(page.nextCursor);
        return { items: collected, nextCursor: more ? row.id : null, scanned };
      }
    }

    if (!page.nextCursor) break;
    cursor = page.items[page.items.length - 1]!.id;
  }

  return { items: collected, nextCursor: null, scanned };
}
