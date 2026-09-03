import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { PortalLoginForm } from "@/components/client-portal/portal-login-form";
import { getClientPortalDisplayName } from "@/lib/client-portal/config";
import { isClientPortalApiConfigured } from "@/lib/client-portal-api/keys";
import { readTrustedPortalSession } from "@/lib/client-portal/portal-auth";
import {
  resolvePortalLoginPageRedirect,
  resolvePortalLoginPageView,
  PORTAL_LOGIN_INTRO,
  PORTAL_LOGIN_SETUP_BANNER,
  PORTAL_LOGIN_TITLE,
} from "@/lib/client-portal/portal-login-flow";
import { CLIENT_PORTAL_SESSION_COOKIE } from "@/lib/client-portal/portal-session";

export const dynamic = "force-dynamic";

function firstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

function safeNextPath(raw: string | undefined): string {
  if (!raw) return "/portal";
  const v = raw.trim();
  if (!v.startsWith("/portal") || v.startsWith("//") || v.includes("\\")) return "/portal";
  return v;
}

export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const next = safeNextPath(firstString(sp.next));
  const apiConfigured = isClientPortalApiConfigured();
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(CLIENT_PORTAL_SESSION_COOKIE)?.value;
  const trusted = await readTrustedPortalSession(sessionCookie);

  const redirectTo = resolvePortalLoginPageRedirect({
    apiConfigured,
    sessionCookie: trusted ? sessionCookie : undefined,
    nextPath: next,
  });
  if (redirectTo) redirect(redirectTo);

  const displayName = getClientPortalDisplayName();
  const loginView = resolvePortalLoginPageView();

  return (
    <div className="min-h-dvh bg-gradient-to-b from-slate-50 to-slate-100/80">
      <div className="mx-auto flex max-w-md flex-col justify-center px-4 py-16 sm:px-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {displayName}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
            {PORTAL_LOGIN_TITLE}
          </h1>
          {firstString(sp.passwordSet) === "1" ? (
            <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-900">
              Your password is saved. Sign in with your email and new password.
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-600">{PORTAL_LOGIN_INTRO}</p>
          )}

          {loginView === "form" ? (
            <PortalLoginForm next={next} />
          ) : (
            <p className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
              {PORTAL_LOGIN_SETUP_BANNER}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
