import { isObserverDocumentPath } from "@/lib/admin-coc-observer-access";
import type { NavItem } from "@/lib/nav";

/**
 * Observer sidebar entries are the admin catalog filtered by the existing
 * document allowlist. This does not grant or remove a route.
 */
export function deriveObserverNavigation(entries: readonly NavItem[]): NavItem[] {
  return entries.filter((item) => isObserverDocumentPath(item.href));
}
