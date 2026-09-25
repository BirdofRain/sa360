"use client";

import { createContext, useContext, type ReactNode } from "react";

import {
  ADMIN_COC_ROLE_OBSERVER,
  type AdminCocRole,
} from "@/lib/admin-coc-observer-access";

const AdminCocAccessContext = createContext<AdminCocRole | null>("ADMIN");

export function AdminCocAccessProvider({
  role,
  children,
}: {
  role: AdminCocRole | null;
  children: ReactNode;
}) {
  return <AdminCocAccessContext.Provider value={role}>{children}</AdminCocAccessContext.Provider>;
}

export function useAdminCocSessionRole(): AdminCocRole | null {
  return useContext(AdminCocAccessContext);
}

/** False only for an explicit read-only observer session. */
export function useAdminCocCanMutate(): boolean {
  return useContext(AdminCocAccessContext) !== ADMIN_COC_ROLE_OBSERVER;
}
