"use client";

import type { ReactNode } from "react";

import { EnvBadge } from "@/components/shell/env-badge";
import { SidebarNav } from "@/components/shell/sidebar-nav";

type DashboardShellProps = {
  children: ReactNode;
  title: string;
  description?: string;
};

export function DashboardShell({ children, title, description }: DashboardShellProps) {
  return (
    <div className="flex min-h-dvh w-full">
      <aside
        className="sticky top-0 flex h-dvh w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
        aria-label="Application"
      >
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <span className="text-sm font-semibold tracking-tight">SA360</span>
          <span className="text-muted-foreground/80">·</span>
          <span className="text-xs font-medium text-muted-foreground">C.O.C.</span>
        </div>
        <SidebarNav />
        <div className="mt-auto border-t border-sidebar-border p-3">
          <p className="px-2 text-[11px] leading-snug text-muted-foreground">
            Beta — connect admin API when ready. No live data yet.
          </p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
            {description ? (
              <p className="truncate text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <EnvBadge />
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
