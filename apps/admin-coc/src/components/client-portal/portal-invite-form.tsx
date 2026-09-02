"use client";

import { useActionState, useState } from "react";

import { portalInviteAcceptAction } from "@/app/actions/portal-invite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PORTAL_INVITE_POLICY_COPY,
  PORTAL_PASSWORD_CONFIRM_MISMATCH,
} from "@/lib/client-portal/portal-invite-flow";

export function PortalInviteForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<
    { error?: string } | undefined,
    FormData
  >(portalInviteAcceptAction, undefined);
  const [mismatch, setMismatch] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function syncMatch(form: HTMLFormElement) {
    const password = (form.elements.namedItem("password") as HTMLInputElement | null)?.value ?? "";
    const confirm =
      (form.elements.namedItem("confirmPassword") as HTMLInputElement | null)?.value ?? "";
    const confirmInput = form.elements.namedItem("confirmPassword") as HTMLInputElement | null;
    const differs = confirm.length > 0 && password !== confirm;
    setMismatch(differs);
    confirmInput?.setCustomValidity(differs ? PORTAL_PASSWORD_CONFIRM_MISMATCH : "");
  }

  return (
    <form
      action={formAction}
      className="mt-6 grid gap-3"
      autoComplete="off"
      onInput={(event) => syncMatch(event.currentTarget)}
      onSubmit={(event) => {
        const form = event.currentTarget;
        const password =
          (form.elements.namedItem("password") as HTMLInputElement | null)?.value ?? "";
        const confirm =
          (form.elements.namedItem("confirmPassword") as HTMLInputElement | null)?.value ?? "";
        if (password !== confirm) {
          event.preventDefault();
          setMismatch(true);
        }
      }}
    >
      <input type="hidden" name="token" value={token} autoComplete="off" />
      <div className="grid gap-1.5">
        <Label htmlFor="portal-invite-password" className="text-xs text-slate-600">
          New password
        </Label>
        <Input
          id="portal-invite-password"
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          minLength={10}
          maxLength={128}
          required
          autoFocus
        />
        <p className="text-xs text-slate-500">{PORTAL_INVITE_POLICY_COPY}</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="portal-invite-confirm-password" className="text-xs text-slate-600">
          Confirm new password
        </Label>
        <Input
          id="portal-invite-confirm-password"
          name="confirmPassword"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          minLength={10}
          maxLength={128}
          required
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={showPassword}
          onChange={(event) => setShowPassword(event.target.checked)}
        />
        Show passwords
      </label>
      {mismatch ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700"
        >
          {PORTAL_PASSWORD_CONFIRM_MISMATCH}
        </p>
      ) : state?.error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700"
        >
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save password and continue"}
      </Button>
    </form>
  );
}
