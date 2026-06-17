import type { NavItem } from "@/lib/nav";

/**
 * Resolves which nav item is active for a pathname.
 * Exact match wins; otherwise longest matching href prefix; only one item active.
 */
export function resolveActiveNavHref(pathname: string, items: NavItem[]): string | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";

  const exact = items.find((item) => item.href === normalized);
  if (exact) return exact.href;

  let best: NavItem | null = null;
  for (const item of items) {
    if (item.href === "/") continue;
    const prefix = `${item.href}/`;
    if (normalized === item.href || normalized.startsWith(prefix)) {
      if (!best || item.href.length > best.href.length) {
        best = item;
      }
    }
  }
  return best?.href ?? null;
}

export function isNavItemActive(pathname: string, href: string, items: NavItem[]): boolean {
  return resolveActiveNavHref(pathname, items) === href;
}
