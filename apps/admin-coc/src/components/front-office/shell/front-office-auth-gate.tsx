import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { canAccessRoute } from "@/lib/front-office/nav";
import { resolveFrontOfficeSession } from "@/lib/front-office/role-context";
import type { FrontOfficeSession } from "@/lib/front-office/types";

import { FrontOfficeUnauthorized } from "./front-office-unauthorized";

export async function FrontOfficeAuthGate({
  pathname,
  devRole,
  children,
  unauthorizedFallback,
}: {
  pathname: string;
  devRole?: string | null;
  children: (session: FrontOfficeSession) => ReactNode;
  unauthorizedFallback?: ReactNode;
}) {
  const session = await resolveFrontOfficeSession(devRole);
  if (!session) {
    redirect(`/front-office/login-chooser?next=${encodeURIComponent(pathname)}`);
  }
  if (!canAccessRoute(session.role, pathname)) {
    return unauthorizedFallback ?? <FrontOfficeUnauthorized session={session} />;
  }
  return children(session);
}
