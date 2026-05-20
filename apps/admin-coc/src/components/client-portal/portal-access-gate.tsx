"use client";

import { useActionState } from "react";

import { submitPortalAccessAction } from "@/app/actions/portal-access";
import { getClientPortalDisplayName } from "@/lib/client-portal/config";
import type { ClientPortalRangeKey } from "@/lib/client-portal/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Temporary client-facing access screen (pre–Phase 3 `/portal/login`).
 */
export function PortalAccessGate({ rangeKey }: { rangeKey: ClientPortalRangeKey }) {
  const displayName = getClientPortalDisplayName();
  const [state, formAction, pending] = useActionState<
    { error?: string } | undefined,
    FormData
  >(submitPortalAccessAction, undefined);

  return (
    <div className="min-h-dvh bg-gradient-to-b from-slate-50 to-slate-100/80">
      <div className="mx-auto flex max-w-md flex-col justify-center px-4 py-16 sm:px-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Secure access
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
            {displayName}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Enter the access code provided by your SA360 team to view your performance
            dashboard.
          </p>

          <form action={formAction} className="mt-6 grid gap-3">
            <input type="hidden" name="range" value={rangeKey} />
            <div className="grid gap-1.5">
              <Label htmlFor="portal-access-code" className="text-xs text-slate-600">
                Access code
              </Label>
              <Input
                id="portal-access-code"
                name="accessCode"
                type="password"
                autoComplete="one-time-code"
                autoFocus
                required
              />
            </div>
            {state?.error ? (
              <p
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700"
              >
                {state.error}
              </p>
            ) : null}
            <Button type="submit" disabled={pending}>
              {pending ? "Verifying…" : "Continue to dashboard"}
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-slate-400">
            Temporary access protection · Full sign-in coming soon
          </p>
        </div>
      </div>
    </div>
  );
}
