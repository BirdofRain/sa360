"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { FrontOfficeSession } from "@/lib/front-office/types";

const FrontOfficeSessionContext = createContext<FrontOfficeSession | null>(null);

export function FrontOfficeSessionProvider({
  session,
  children,
}: {
  session: FrontOfficeSession;
  children: ReactNode;
}) {
  return (
    <FrontOfficeSessionContext.Provider value={session}>
      {children}
    </FrontOfficeSessionContext.Provider>
  );
}

export function useFrontOfficeSession(): FrontOfficeSession {
  const ctx = useContext(FrontOfficeSessionContext);
  if (!ctx) {
    throw new Error("useFrontOfficeSession must be used within FrontOfficeSessionProvider");
  }
  return ctx;
}
