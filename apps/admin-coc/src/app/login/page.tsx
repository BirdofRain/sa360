import { redirect } from "next/navigation";

import { STAFF_SIGN_IN_URL } from "@sa360/shared/staff-sign-in-url";

import { LoginForm } from "@/components/auth/login-form";
import {
  isAdminCocObserverLoginAvailable,
  isAdminCocPasswordConfigured,
} from "@/lib/admin-coc-auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";

  if (!isAdminCocPasswordConfigured()) {
    redirect(next);
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
        <div className="mb-4 flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-lg bg-slate-900 text-sm font-semibold text-white">
            S
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight text-slate-900">
              Smart Agent 360
            </div>
            <div className="text-[11px] leading-tight text-slate-500">
              Central Operating Center
            </div>
          </div>
        </div>
        <h1 className="text-base font-semibold text-slate-900">Sign in</h1>
        <a
          href={STAFF_SIGN_IN_URL}
          className="mt-4 flex h-9 w-full items-center justify-center rounded-lg bg-slate-900 text-sm font-medium text-white"
        >
          Continue with Google
        </a>
        <p className="mt-4 text-xs text-slate-500">
          {isAdminCocObserverLoginAvailable()
            ? "Password fallback: enter the admin password, or the read-only observer password when it is configured on the server."
            : "Password fallback: enter the admin password to access the internal dashboard."}
        </p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
