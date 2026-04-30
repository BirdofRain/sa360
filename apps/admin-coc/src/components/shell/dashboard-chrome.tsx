"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { DashboardShell } from "@/components/shell/dashboard-shell";
import { resolvePageMeta } from "@/lib/page-meta";

export function DashboardChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const meta = resolvePageMeta(pathname);

  return (
    <DashboardShell title={meta.title} description={meta.description}>
      {children}
    </DashboardShell>
  );
}
