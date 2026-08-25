export type PortalNavItem = {
  href: string;
  label: string;
  match: "exact" | "prefix";
};

export const PORTAL_NAV_ITEMS: PortalNavItem[] = [
  { href: "/portal", label: "Overview", match: "exact" },
  { href: "/portal/orders", label: "Orders", match: "prefix" },
  { href: "/portal/leads", label: "Leads", match: "prefix" },
  { href: "/portal/account", label: "Account", match: "prefix" },
];

export function safePortalNextPath(raw: string | undefined, fallback = "/portal"): string {
  if (!raw) return fallback;
  const v = raw.trim();
  if (!v.startsWith("/portal") || v.startsWith("//") || v.includes("\\")) return fallback;
  return v;
}

export function isPortalNavItemActive(pathname: string, item: PortalNavItem): boolean {
  const path = pathname.split("?")[0] || pathname;
  if (item.match === "exact") return path === item.href;
  return path === item.href || path.startsWith(`${item.href}/`);
}
