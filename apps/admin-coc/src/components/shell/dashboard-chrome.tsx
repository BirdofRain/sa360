"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { DashboardShell } from "@/components/shell/dashboard-shell";
import type { AdminCocRole } from "@/lib/admin-coc-observer-access";
import { resolvePageMeta } from "@/lib/page-meta";

export function DashboardChrome({
  children,
  adminGateEnabled,
  sessionRole,
}: {
  children: ReactNode;
  adminGateEnabled: boolean;
  sessionRole: AdminCocRole | null;
}) {
  const pathname = usePathname();
  const meta = resolvePageMeta(pathname);

  return (
    <DashboardShell
      title={meta.title}
      description={meta.description}
      adminGateEnabled={adminGateEnabled}
      sessionRole={sessionRole}
    >
      {children}
    </DashboardShell>
  );
}
