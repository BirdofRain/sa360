"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isPortalNavItemActive, PORTAL_NAV_ITEMS } from "@/lib/client-portal/portal-nav";
import { cn } from "@/lib/utils";

export function PortalNavLinks({ pathname }: { pathname: string }) {
  return (
    <nav
      className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0"
      aria-label="Portal"
    >
      <ul className="flex min-w-max gap-1">
        {PORTAL_NAV_ITEMS.map((item) => {
          const active = isPortalNavItemActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "inline-flex min-h-10 items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-white hover:text-slate-900"
                )}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function PortalNav() {
  const pathname = usePathname();
  return <PortalNavLinks pathname={pathname} />;
}
