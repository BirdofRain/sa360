"use client";

import { useFormStatus } from "react-dom";

import { logoutAction } from "@/app/actions/login";
import { Button } from "@/components/ui/button";

function LogoutButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="xs" className="w-full" disabled={pending}>
      {pending ? "Signing out…" : "Logout"}
    </Button>
  );
}

/**
 * Shown only on dashboard chrome (not embed `/agent-workspace`).
 * When the password gate is off (local dev), shows a short notice instead of logout.
 */
export function AdminSessionFooter({ gateEnabled }: { gateEnabled: boolean }) {
  if (!gateEnabled) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/80 px-2.5 py-2">
        <p className="text-[11px] leading-snug text-slate-500">
          Login gate off — set <span className="font-mono text-[10px] text-slate-600">ADMIN_COC_PASSWORD</span> to
          require a session.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-2">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-700">
        <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
        Logged in
      </div>
      <form action={logoutAction}>
        <LogoutButton />
      </form>
    </div>
  );
}
