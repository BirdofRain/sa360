"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { filterNavByRole, roleBadgeLabel } from "@/lib/front-office/nav";
import { cn } from "@/lib/utils";

import { useFrontOfficeSession } from "./front-office-session-context";

export function FrontOfficeSidebar({
  mobileOpen,
  onMobileClose,
}: {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const session = useFrontOfficeSession();
  const items = filterNavByRole(session.role);

  const nav = (
    <>
      <div className="border-b border-slate-800 px-4 py-5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          SA360
        </p>
        <p className="mt-0.5 text-sm font-semibold text-white">Front Office</p>
        <span className="mt-2 inline-flex rounded-full border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[10px] font-medium text-slate-300">
          {roleBadgeLabel(session.role)}
        </span>
      </div>
      <nav className="flex-1 space-y-0.5 p-3">
        {items.map((item) => {
          const active =
            item.href === "/front-office"
              ? pathname === "/front-office"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onMobileClose}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                active
                  ? "bg-white/10 text-white"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );

  return (
    <>
      <aside className="hidden w-[240px] shrink-0 flex-col border-r border-slate-800 bg-slate-950 lg:flex">
        {nav}
      </aside>
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close navigation"
            onClick={onMobileClose}
          />
          <aside className="relative flex h-full w-[240px] flex-col bg-slate-950 shadow-xl">
            {nav}
          </aside>
        </div>
      ) : null}
    </>
  );
}
