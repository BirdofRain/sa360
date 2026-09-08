"use client";

import type { ReactNode } from "react";

import { PublicSiteHeader } from "./public-site-header";

export function PublicSiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="avl-shell relative min-h-dvh overflow-hidden">
      <PublicSiteHeader />
      {children}
    </div>
  );
}
