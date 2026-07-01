"use client";

import { Suspense, useState, type ReactNode } from "react";

import { FrontOfficeHeader } from "./front-office-header";
import { FrontOfficeSidebar } from "./front-office-sidebar";
import { FrontOfficeSessionProvider } from "./front-office-session-context";
import type { FrontOfficeSession } from "@/lib/front-office/types";

export function FrontOfficeShell({
  session,
  title,
  subtitle,
  dataSource,
  children,
}: {
  session: FrontOfficeSession;
  title: string;
  subtitle?: string;
  dataSource?: "mock" | "live" | "partial_live" | "mixed";
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <FrontOfficeSessionProvider session={session}>
      <div className="flex min-h-dvh bg-slate-50">
        <FrontOfficeSidebar
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Suspense
            fallback={
              <header className="sticky top-0 z-40 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
                <div className="h-8 animate-pulse rounded bg-slate-100" />
              </header>
            }
          >
            <FrontOfficeHeader
              title={title}
              subtitle={subtitle}
              dataSource={dataSource}
              onMenuClick={() => setMobileOpen(true)}
            />
          </Suspense>
          <main className="flex-1 p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </FrontOfficeSessionProvider>
  );
}
