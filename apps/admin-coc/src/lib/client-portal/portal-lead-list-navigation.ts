import {
  portalLeadListPath,
  type PortalLeadListStatus,
} from "./portal-lead-list-status.ts";

/**
 * Next.js App Router <Link> soft-navigates same-pathname query changes.
 * Removing `?status=delivered` (All) can update the URL / active pill while
 * the RSC tree for the list/empty state is not applied. Filter clicks must
 * use an explicit push + refresh rather than relying on Link prefetch cache.
 */
export function isUnmodifiedPortalLeadListClick(event: {
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  button?: number;
}): boolean {
  return (
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    (event.button ?? 0) === 0
  );
}

export function portalLeadListNeedsExplicitRefresh(
  current: PortalLeadListStatus,
  next: PortalLeadListStatus
): boolean {
  return current !== next;
}

export function portalLeadListHref(status: PortalLeadListStatus): string {
  return portalLeadListPath(status);
}
