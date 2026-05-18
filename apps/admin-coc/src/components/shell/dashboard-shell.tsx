"use client";

import type { ReactNode } from "react";

import { AdminSessionFooter } from "@/components/auth/admin-session-footer";
import { DashboardHeader } from "@/components/shell/dashboard-header";
import { SidebarNav } from "@/components/shell/sidebar-nav";

type DashboardShellProps = {
  children: ReactNode;
  title: string;
  description?: string;
  adminGateEnabled: boolean;
};

/**
 * App chrome — sidebar + header aligned with Figma reference layout
 * (`docs/figma/generated-reference/internal-admin-dashboard`).
 */
export function DashboardShell({
  children,
  title,
  description,
  adminGateEnabled,
}: DashboardShellProps) {
  return (
    <div className="flex h-screen min-h-screen w-full bg-slate-50 text-slate-900">
      <aside
        className="sticky top-0 flex h-screen w-[248px] shrink-0 flex-col border-r border-slate-200 bg-white"
        aria-label="Application"
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="grid size-8 place-items-center rounded-lg bg-slate-900 text-sm font-semibold text-white">
            S
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight text-slate-900">Smart Agent 360</div>
            <div className="text-[11px] leading-tight text-slate-500">Central Operating Center</div>
          </div>
        </div>
        <div className="px-3 pb-2">
          <div className="rounded-md bg-slate-50 px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Workspace</div>
            <div className="text-xs font-medium text-slate-800">SA360 · Internal Admin</div>
          </div>
        </div>
        <SidebarNav />
        <div className="mt-auto space-y-3 border-t border-slate-100 px-3 py-3">
          <AdminSessionFooter gateEnabled={adminGateEnabled} />
          <p className="text-[11px] leading-snug text-slate-500">
            Beta UI — connect admin API when ready. Visual reference:{" "}
            <span className="font-mono text-[10px] text-slate-400">docs/figma/generated-reference</span>
          </p>
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <DashboardHeader title={title} subtitle={description} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
