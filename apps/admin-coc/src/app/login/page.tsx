import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { isAdminCocPasswordConfigured } from "@/lib/admin-coc-auth";

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
        <p className="mt-0.5 text-xs text-slate-500">
          Enter the admin password to access the internal dashboard.
        </p>
        <LoginForm next={next} />
        <p className="mt-4 text-[11px] text-slate-400">
          Temporary password gate. Replaced when Google sign-in lands.
        </p>
      </div>
    </main>
  );
}
