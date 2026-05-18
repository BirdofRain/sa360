"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { DashboardShell } from "@/components/shell/dashboard-shell";
import { resolvePageMeta } from "@/lib/page-meta";

export function DashboardChrome({
  children,
  adminGateEnabled,
}: {
  children: ReactNode;
  adminGateEnabled: boolean;
}) {
  const pathname = usePathname();
  const meta = resolvePageMeta(pathname);

  return (
    <DashboardShell
      title={meta.title}
      description={meta.description}
      adminGateEnabled={adminGateEnabled}
    >
      {children}
    </DashboardShell>
  );
}
