"use client";

import { useActionState, useCallback, useRef, useState } from "react";

import {
  ACCOUNT_SETUP_NICHE_HELP,
  ACCOUNT_SETUP_NICHE_PLACEHOLDER,
  ACCOUNT_SETUP_PRODUCT_HELP,
  ACCOUNT_SETUP_PRODUCT_PLACEHOLDER,
  clientProfileFieldError,
  customerAccountErrorCopy,
  formatCommaSeparatedList,
  missingRequiredAccountFields,
  profilePayloadFromForm,
  type PortalAccountFormAction,
  type PortalAccountProfile,
} from "@/lib/client-portal/account-profile";

const inputClass =
  "min-h-12 w-full rounded-xl border border-white/15 bg-white/5 px-3 text-sm text-white placeholder:text-[#9bb0c3] focus:border-[#e4c36a]/60 focus:outline-none focus:ring-2 focus:ring-[#e4c36a]/30";

export function AgedVetSetupForm({
  initialAccount,
  loginEmail,
  saveActionImpl,
  completeActionImpl,
}: {
  initialAccount: PortalAccountProfile;
  loginEmail: string | null;
  saveActionImpl: PortalAccountFormAction;
  completeActionImpl: PortalAccountFormAction;
}) {
  const completeImplRef = useRef<PortalAccountFormAction>(completeActionImpl);
  completeImplRef.current = completeActionImpl;
  const [saveState, saveAction, savePending] = useActionState(saveActionImpl, undefined);
  const completeWithRequiredCheck = useCallback<PortalAccountFormAction>(
    async (prev, formData) => {
      const missing = missingRequiredAccountFields(profilePayloadFromForm(formData));
      if (missing.length > 0) {
        return {
          ok: false,
          error: customerAccountErrorCopy("PROFILE_INCOMPLETE", 400),
          missingFields: missing,
        };
      }
      return completeImplRef.current(prev, formData);
    },
    []
  );
  const [completeState, completeAction, completePending] = useActionState(
    completeWithRequiredCheck,
    undefined
  );

  const account =
    (completeState?.ok && completeState.account) ||
    (saveState?.ok && saveState.account) ||
    completeState?.account ||
    saveState?.account ||
    initialAccount;
  const pending = savePending || completePending;
  const missingFields = completeState?.missingFields ?? [];
  const formError =
    completeState?.ok === false
      ? completeState.error
      : saveState?.ok === false
        ? saveState.error
        : undefined;
  const saveSuccess = saveState?.ok && !account.readyToOrder;

  const [displayName, setDisplayName] = useState(account.clientDisplayName);
  const [greeting, setGreeting] = useState(account.portalDisplayName ?? "");
  const [niches, setNiches] = useState(formatCommaSeparatedList(account.primaryNicheKeys));
  const [products, setProducts] = useState(formatCommaSeparatedList(account.primaryProductTypes));

  const nameError = clientProfileFieldError("clientDisplayName", missingFields);
  const nicheError = clientProfileFieldError("primaryNicheKeys", missingFields);
  const productError = clientProfileFieldError("primaryProductTypes", missingFields);

  return (
    <div className="avl-card rounded-3xl p-6 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#e4c36a]">
        Customer setup
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
        Finish your account
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-[#b7c7d6]">
        Tell us how to label your desk and which Veteran products you work. Then continue to
        place a request. Nothing here confirms payment or approves an order.
      </p>
      {loginEmail ? (
        <p className="mt-3 text-xs text-[#9bb0c3]">Signed in as {loginEmail}</p>
      ) : null}

      <form className="mt-8 grid gap-4" noValidate>
        <div className="grid gap-1.5">
          <label htmlFor="clientDisplayName" className="text-sm font-medium text-[#d7e3ee]">
            Account name
          </label>
          <input
            id="clientDisplayName"
            name="clientDisplayName"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
            autoComplete="organization"
            className={inputClass}
            disabled={pending}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? "clientDisplayName-error" : undefined}
          />
          {nameError ? (
            <p id="clientDisplayName-error" role="alert" className="text-xs text-red-200">
              {nameError}
            </p>
          ) : null}
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="portalDisplayName" className="text-sm font-medium text-[#d7e3ee]">
            Greeting name <span className="font-normal text-[#9bb0c3]">(optional)</span>
          </label>
          <input
            id="portalDisplayName"
            name="portalDisplayName"
            value={greeting}
            onChange={(event) => setGreeting(event.target.value)}
            autoComplete="nickname"
            className={inputClass}
            disabled={pending}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="primaryNicheKeys" className="text-sm font-medium text-[#d7e3ee]">
            Lead focus
          </label>
          <input
            id="primaryNicheKeys"
            name="primaryNicheKeys"
            value={niches}
            onChange={(event) => setNiches(event.target.value)}
            required
            placeholder={ACCOUNT_SETUP_NICHE_PLACEHOLDER}
            className={`${inputClass} placeholder:italic`}
            disabled={pending}
            aria-invalid={nicheError ? true : undefined}
            aria-describedby={nicheError ? "primaryNicheKeys-error" : "primaryNicheKeys-help"}
          />
          <p id="primaryNicheKeys-help" className="text-xs text-[#9bb0c3]">
            {ACCOUNT_SETUP_NICHE_HELP}
          </p>
          {nicheError ? (
            <p id="primaryNicheKeys-error" role="alert" className="text-xs text-red-200">
              {nicheError}
            </p>
          ) : null}
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="primaryProductTypes" className="text-sm font-medium text-[#d7e3ee]">
            Product types
          </label>
          <input
            id="primaryProductTypes"
            name="primaryProductTypes"
            value={products}
            onChange={(event) => setProducts(event.target.value)}
            required
            placeholder={ACCOUNT_SETUP_PRODUCT_PLACEHOLDER}
            className={`${inputClass} placeholder:italic`}
            disabled={pending}
            aria-invalid={productError ? true : undefined}
            aria-describedby={
              productError ? "primaryProductTypes-error" : "primaryProductTypes-help"
            }
          />
          <p id="primaryProductTypes-help" className="text-xs text-[#9bb0c3]">
            {ACCOUNT_SETUP_PRODUCT_HELP}
          </p>
          {productError ? (
            <p id="primaryProductTypes-error" role="alert" className="text-xs text-red-200">
              {productError}
            </p>
          ) : null}
        </div>
        {formError ? (
          <p
            role="alert"
            className="rounded-xl border border-red-400/30 bg-red-950/40 px-3 py-2 text-sm text-red-100"
          >
            {formError}
          </p>
        ) : null}
        {saveSuccess ? (
          <p
            role="status"
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-[#d7e3ee]"
          >
            Progress saved. Finish setup when the required fields are complete.
          </p>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="submit"
            formAction={completeAction}
            disabled={pending}
            className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full bg-[#e4c36a] px-6 text-sm font-semibold text-[#071422] hover:bg-[#f3d98a] disabled:opacity-60"
          >
            {completePending ? "Finishing setup…" : "Finish setup and continue"}
          </button>
          <button
            type="submit"
            formAction={saveAction}
            disabled={pending}
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/20 px-6 text-sm font-semibold text-white hover:bg-white/5 disabled:opacity-60"
          >
            {savePending ? "Saving…" : "Save progress"}
          </button>
        </div>
      </form>
    </div>
  );
}
