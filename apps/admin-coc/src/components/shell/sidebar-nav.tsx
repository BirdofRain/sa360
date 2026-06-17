"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { bulkImportsNavItem, configurationNav, operationsNav, planningNav, supportTicketsNavItem } from "@/lib/nav";
import { isBulkSourceImportsEnabled } from "@/lib/bulk-imports/config";
import { isNavItemActive } from "@/lib/bulk-imports/nav-active";
import { isSupportTicketsEnabled } from "@/lib/support-tickets/config";
import { cn } from "@/lib/utils";

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
  return (
    <Link
      href={href}
      className={cn(
        "group mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
        active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
      )}
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

export function SidebarNav() {
  const pathname = usePathname();
  const showSupport = isSupportTicketsEnabled();
  const showBulkImports = isBulkSourceImportsEnabled();
  const navItems = showBulkImports
    ? [...operationsNav, bulkImportsNavItem]
    : operationsNav;

  return (
    <nav className="mt-2 flex flex-1 flex-col px-2" aria-label="Main">
      <div className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-wider text-slate-400">Operations</div>
      {operationsNav.map((item) => (
        <NavRow
          key={item.href}
          href={item.href}
          label={item.label}
          icon={item.icon}
          badge={item.badge}
          active={isNavItemActive(pathname, item.href, navItems)}
        />
      ))}
      {showBulkImports ? (
        <NavRow
          href={bulkImportsNavItem.href}
          label={bulkImportsNavItem.label}
          icon={bulkImportsNavItem.icon}
          active={isNavItemActive(pathname, bulkImportsNavItem.href, navItems)}
        />
      ) : null}
      <div className="px-2 pb-1 pt-3 text-[10px] uppercase tracking-wider text-slate-400">Configuration</div>
      {configurationNav.map((item) => (
        <NavRow
          key={item.href}
          href={item.href}
          label={item.label}
          icon={item.icon}
          badge={item.badge}
          active={isNavItemActive(pathname, item.href, configurationNav)}
        />
      ))}
      {showSupport ? (
        <NavRow
          href={supportTicketsNavItem.href}
          label={supportTicketsNavItem.label}
          icon={supportTicketsNavItem.icon}
          active={isNavItemActive(pathname, supportTicketsNavItem.href, [supportTicketsNavItem])}
        />
      ) : null}
      <div className="px-2 pb-1 pt-3 text-[10px] uppercase tracking-wider text-slate-400">Planning</div>
      {planningNav.map((item) => (
        <NavRow
          key={item.href}
          href={item.href}
          label={item.label}
          icon={item.icon}
          badge={item.badge}
          active={isNavItemActive(pathname, item.href, planningNav)}
        />
      ))}
    </nav>
  );
}
