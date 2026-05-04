"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { configurationNav, operationsNav } from "@/lib/nav";
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

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

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
          active={isActive(item.href)}
        />
      ))}
      <div className="px-2 pb-1 pt-3 text-[10px] uppercase tracking-wider text-slate-400">Configuration</div>
      {configurationNav.map((item) => (
        <NavRow
          key={item.href}
          href={item.href}
          label={item.label}
          icon={item.icon}
          badge={item.badge}
          active={isActive(item.href)}
        />
      ))}
    </nav>
  );
}
