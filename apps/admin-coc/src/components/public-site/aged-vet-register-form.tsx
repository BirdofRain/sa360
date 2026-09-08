"use client";

import { useActionState } from "react";
import Link from "next/link";
import { PORTAL_PASSWORD_POLICY_COPY } from "@sa360/shared";

import { portalRegisterAction, type PortalRegisterActionState } from "@/app/actions/portal-register";
import {
  PUBLIC_PORTAL_INVITE_HREF,
  PUBLIC_PORTAL_SIGN_IN_HREF,
} from "@/lib/public-site/lead-request-preview";

const inputClass =
  "min-h-12 w-full rounded-xl border border-white/15 bg-white/5 px-3 text-sm text-white placeholder:text-[#9bb0c3] focus:border-[#e4c36a]/60 focus:outline-none focus:ring-2 focus:ring-[#e4c36a]/30";

export function AgedVetRegisterForm() {
  const [state, formAction, pending] = useActionState<
    PortalRegisterActionState | undefined,
    FormData
  >(portalRegisterAction, undefined);

  return (
    <div className="avl-card rounded-3xl p-6 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#e4c36a]">
        Create account
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
        Open your Aged Vet Leads account
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-[#b7c7d6]">
        Create a login, finish a short setup, then submit a Veteran lead request. Payment stays
        with our team. Orders wait for approval — this does not charge a card or start
        fulfillment.
      </p>

      <form action={formAction} className="mt-8 grid gap-4" noValidate>
        <div className="grid gap-1.5">
          <label htmlFor="agencyName" className="text-sm font-medium text-[#d7e3ee]">
            Agency or business name
          </label>
          <input
            id="agencyName"
            name="agencyName"
            type="text"
            required
            minLength={2}
            maxLength={200}
            autoComplete="organization"
            className={inputClass}
            disabled={pending}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="email" className="text-sm font-medium text-[#d7e3ee]">
            Work email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            maxLength={320}
            autoComplete="email"
            className={inputClass}
            disabled={pending}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="password" className="text-sm font-medium text-[#d7e3ee]">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
            className={inputClass}
            disabled={pending}
            aria-describedby="password-help"
          />
          <p id="password-help" className="text-xs text-[#9bb0c3]">
            {PORTAL_PASSWORD_POLICY_COPY}
          </p>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="confirmPassword" className="text-sm font-medium text-[#d7e3ee]">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
            className={inputClass}
            disabled={pending}
          />
        </div>
        {state?.error ? (
          <p
            role="alert"
            className="rounded-xl border border-red-400/30 bg-red-950/40 px-3 py-2 text-sm text-red-100"
          >
            {state.error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#e4c36a] px-6 text-sm font-semibold text-[#071422] hover:bg-[#f3d98a] disabled:opacity-60"
        >
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-sm text-[#9bb0c3]">
        Already have an account?{" "}
        <Link
          href={PUBLIC_PORTAL_SIGN_IN_HREF}
          className="font-semibold text-[#e4c36a] underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
        . Have an invite?{" "}
        <Link
          href={PUBLIC_PORTAL_INVITE_HREF}
          className="font-semibold text-[#e4c36a] underline-offset-4 hover:underline"
        >
          Open invite
        </Link>
        .
      </p>
    </div>
  );
}
