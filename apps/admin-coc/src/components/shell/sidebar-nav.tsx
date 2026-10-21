"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useAdminCocCanMutate } from "@/components/auth/admin-coc-access";
import { isBulkSourceImportsEnabled } from "@/lib/bulk-imports/config";
import { isNavItemActive, resolveActiveNavHref } from "@/lib/bulk-imports/nav-active";
import {
  adminToolsSectionItems,
  teamNav,
  visibleAdminNavItems,
  type NavItem,
} from "@/lib/nav";
import { deriveObserverNavigation } from "@/lib/nav-visibility";
import { isSupportTicketsEnabled } from "@/lib/support-tickets/config";
import { cn } from "@/lib/utils";

/** Heavy ops pages that execute expensive Admin API work in RSC — do not prefetch. */
const HEAVY_ROUTE_HREFS = new Set([
  "/fulfillment-ops",
  "/webhooks",
  "/automation-dashboard",
  "/lead-fulfillment",
  "/lead-inventory",
]);

function NavRow({
  href,
  label,
  icon: Icon,
  badge,
  active,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  active: boolean;
}) {
  const prefetch = HEAVY_ROUTE_HREFS.has(href) ? false : undefined;
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={cn(
        "group mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
        active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          active ? "text-white" : "text-slate-500 group-hover:text-slate-700"
        )}
        aria-hidden
      />
      <span className="flex-1 text-left">{label}</span>
      {badge ? (
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px]",
            active ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"
          )}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

function NavRows({
  items,
  pathname,
  activeItems,
}: {
  items: NavItem[];
  pathname: string;
  activeItems: NavItem[];
}) {
  return items.map((item) => (
    <NavRow
      key={item.href}
      href={item.href}
      label={item.label}
      icon={item.icon}
      badge={item.badge}
      active={isNavItemActive(pathname, item.href, activeItems)}
    />
  ));
}

export function SidebarNav() {
  const pathname = usePathname();
  const canMutate = useAdminCocCanMutate();
  const showSupport = canMutate && isSupportTicketsEnabled();
  const showBulkImports = canMutate && isBulkSourceImportsEnabled();
  const sectionOptions = { bulkImports: showBulkImports, supportTickets: showSupport };
  const adminItems = visibleAdminNavItems(sectionOptions);
  const adminSection = adminToolsSectionItems(sectionOptions);
  const observerItems = deriveObserverNavigation(adminItems);
  const activeItems = canMutate ? adminItems : observerItems;
  const activeHref = resolveActiveNavHref(pathname, activeItems);
  const adminSectionActive = adminSection.some((item) => item.href === activeHref);

  const [open, setOpen] = useState(adminSectionActive);
  const [trackedPath, setTrackedPath] = useState(pathname);
  if (trackedPath !== pathname) {
    setTrackedPath(pathname);
    setOpen(adminSectionActive);
  }

  return (
    <nav className="mt-2 flex min-h-0 flex-1 flex-col overflow-y-auto px-2" aria-label="Main">
      {canMutate ? (
        <>
          <div className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-wider text-slate-400">
            Team
          </div>
          <NavRows items={teamNav} pathname={pathname} activeItems={activeItems} />
          <button
            type="button"
            className="mt-3 flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-[10px] uppercase tracking-wider text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-expanded={open}
            aria-controls="admin-tools-nav"
            onClick={() => setOpen((current) => !current)}
          >
            <ChevronRight
              className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
              aria-hidden
            />
            Admin Tools
          </button>
          {open ? (
            <div id="admin-tools-nav">
              <NavRows items={adminSection} pathname={pathname} activeItems={activeItems} />
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-wider text-slate-400">
            Operations
          </div>
          <NavRows items={observerItems} pathname={pathname} activeItems={activeItems} />
        </>
      )}
    </nav>
  );
}
