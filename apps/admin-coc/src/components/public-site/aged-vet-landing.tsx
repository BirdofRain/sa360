"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Lock,
  MapPin,
  Shield,
  Sparkles,
} from "lucide-react";

import { writePublicLeadPrefill } from "@/lib/public-site/lead-request-handoff";
import {
  clampPublicLeadQuantity,
  createEmptyPublicLeadPreviewDraft,
  PUBLIC_FEATURED_STATE_CODES,
  PUBLIC_LEAD_QUANTITY_PRESETS,
  PUBLIC_PORTAL_INVITE_HREF,
  PUBLIC_PORTAL_SIGN_IN_HREF,
  PUBLIC_REGISTER_HREF,
  PUBLIC_VETERAN_FRESHNESS_OPTIONS,
  publicPreviewContinueHref,
  publicPreviewSummary,
  publicStateOptions,
  togglePublicPreviewState,
  type PublicLeadPreviewDraft,
} from "@/lib/public-site/lead-request-preview";

import { PublicSiteHeader } from "./public-site-header";

const steps = [
  {
    title: "Get started",
    body: "Create an account, then preview states, quantity, and freshness. Nothing is billed from this page.",
  },
  {
    title: "Open your account",
    body: "New agents create a login here. Invited agents set a password from the invite link, then sign in.",
  },
  {
    title: "Configure & submit",
    body: "In your account, submit a Veteran lead request. It lands as submitted — not live fulfillment.",
  },
  {
    title: "We confirm payment",
    body: "Alex reviews the request and confirms payment outside this site, then approves the order.",
  },
  {
    title: "Track delivery",
    body: "Return to your account to watch status and receive released leads when the package is approved.",
  },
];

export function AgedVetLanding() {
  const [draft, setDraft] = useState<PublicLeadPreviewDraft>(createEmptyPublicLeadPreviewDraft);
  const [showAllStates, setShowAllStates] = useState(false);
  const allStates = useMemo(() => publicStateOptions(), []);
  const featured = useMemo(() => {
    const featuredSet = new Set<string>(PUBLIC_FEATURED_STATE_CODES);
    return allStates.filter((option) => featuredSet.has(option.value));
  }, [allStates]);
  const visibleStates = showAllStates ? allStates : featured;
  const summary = publicPreviewSummary(draft);
  const continueHref = publicPreviewContinueHref(draft);

  function persistDraft(next: PublicLeadPreviewDraft = draft) {
    writePublicLeadPrefill(next);
  }

  function setQuantity(value: number) {
    setDraft((current) => {
      const next = { ...current, quantity: clampPublicLeadQuantity(value) };
      persistDraft(next);
      return next;
    });
  }

  return (
    <div className="avl-shell relative min-h-dvh overflow-hidden">
      <PublicSiteHeader />

      <main className="relative mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <section className="grid gap-10 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-16">
          <div className="space-y-6">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#e4c36a]/30 bg-[#e4c36a]/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-[#e4c36a]">
              <Sparkles className="size-3.5" aria-hidden />
              For insurance agents
            </p>
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-[3.4rem] lg:leading-[1.08]">
              Veteran leads, built for agents who actually work them.
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-[#b7c7d6] sm:text-lg">
              Aged Vet Leads is a focused Veteran-lead desk — not a generic funnel page and not an
              admin console. Choose states, quantity, and freshness, then submit a request from your
              account. Payment stays with our team. Delivery stays in your portal.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href={PUBLIC_REGISTER_HREF}
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#e4c36a] px-6 text-sm font-semibold text-[#071422] hover:bg-[#f3d98a]"
              >
                Get started
                <ArrowRight className="ml-2 size-4" aria-hidden />
              </Link>
              <Link
                href={PUBLIC_PORTAL_SIGN_IN_HREF}
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/20 px-6 text-sm font-semibold text-white hover:bg-white/5"
              >
                Sign in
              </Link>
            </div>
            <ul className="grid gap-3 pt-2 text-sm text-[#c5d3e0] sm:grid-cols-3">
              <li className="flex items-start gap-2">
                <Shield className="mt-0.5 size-4 shrink-0 text-[#e4c36a]" aria-hidden />
                Veteran-only inventory
              </li>
              <li className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0 text-[#e4c36a]" aria-hidden />
                State-level targeting
              </li>
              <li className="flex items-start gap-2">
                <Lock className="mt-0.5 size-4 shrink-0 text-[#e4c36a]" aria-hidden />
                Reviewed before release
              </li>
            </ul>
          </div>

          <aside className="avl-card relative overflow-hidden rounded-3xl p-5 sm:p-6" aria-label="Why agents switch">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#e4c36a]">
              Built for the close
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              Exclusive Veteran conversations, not leftover mixed traffic.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[#b7c7d6]">
              Preview a request in seconds. Submit it after you sign in. Your order stays visible
              while we confirm payment, approve, and release delivery into the same account.
            </p>
            <dl className="mt-6 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-2 py-3">
                <dt className="text-[11px] uppercase tracking-wide text-[#9bb0c3]">Niche</dt>
                <dd className="mt-1 text-sm font-semibold text-white">Veteran</dd>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-2 py-3">
                <dt className="text-[11px] uppercase tracking-wide text-[#9bb0c3]">Buyer</dt>
                <dd className="mt-1 text-sm font-semibold text-white">Agents</dd>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-2 py-3">
                <dt className="text-[11px] uppercase tracking-wide text-[#9bb0c3]">Checkout</dt>
                <dd className="mt-1 text-sm font-semibold text-white">Manual</dd>
              </div>
            </dl>
          </aside>
        </section>

        <section id="preview" className="scroll-mt-24 space-y-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#e4c36a]">
                Interactive preview
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Configure a Veteran lead request
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-[#b7c7d6]">
                Same choices you will use in your account: states, quantity, and freshness / age
                bucket. This preview does not place an order.
              </p>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="avl-card space-y-8 rounded-3xl p-5 sm:p-7">
              <fieldset>
                <legend className="text-sm font-semibold text-white">States</legend>
                <p className="mt-1 text-xs text-[#9bb0c3]">Select every licensed state you want filled.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {visibleStates.map((option) => {
                    const selected = draft.states.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        aria-label={option.label}
                        data-selected={selected}
                        className="avl-chip min-h-10 rounded-full border border-white/15 px-3 text-sm text-[#d7e3ee] transition hover:border-[#e4c36a]/50"
                        onClick={() =>
                          setDraft((current) => {
                            const next = {
                              ...current,
                              states: togglePublicPreviewState(current.states, option.value),
                            };
                            persistDraft(next);
                            return next;
                          })
                        }
                      >
                        {option.value}
                        <span className="sr-only">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="mt-3 min-h-10 text-sm font-medium text-[#e4c36a] underline-offset-4 hover:underline"
                  onClick={() => setShowAllStates((value) => !value)}
                >
                  {showAllStates ? "Show featured states" : "Show all states"}
                </button>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-semibold text-white">Quantity</legend>
                <div className="mt-3 flex flex-wrap gap-2">
                  {PUBLIC_LEAD_QUANTITY_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      aria-pressed={draft.quantity === preset}
                      aria-label={`${preset} leads`}
                      data-selected={draft.quantity === preset}
                      className="avl-chip min-h-10 rounded-full border border-white/15 px-4 text-sm text-[#d7e3ee] hover:border-[#e4c36a]/50"
                      onClick={() => setQuantity(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <label className="mt-3 block text-xs text-[#9bb0c3]" htmlFor="avl-qty">
                  Custom quantity
                </label>
                <input
                  id="avl-qty"
                  type="number"
                  min={1}
                  max={1_000_000}
                  value={draft.quantity}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                  className="mt-1 h-11 w-full max-w-xs rounded-xl border border-white/15 bg-white/5 px-3 text-white outline-none ring-[#e4c36a] focus:ring-2"
                />
              </fieldset>

              <fieldset>
                <legend className="text-sm font-semibold text-white">Freshness / age bucket</legend>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {PUBLIC_VETERAN_FRESHNESS_OPTIONS.map((option) => {
                    const selected = draft.freshnessId === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={selected}
                        aria-label={`${option.label}. ${option.description}`}
                        data-selected={selected}
                        className="avl-fresh rounded-2xl border border-white/12 p-4 text-left hover:border-[#e4c36a]/40"
                        onClick={() =>
                          setDraft((current) => {
                            const next = { ...current, freshnessId: option.id };
                            persistDraft(next);
                            return next;
                          })
                        }
                      >
                        <span className="flex items-center gap-2 text-sm font-semibold text-white">
                          <Clock3 className="size-4 text-[#e4c36a]" aria-hidden />
                          {option.label}
                        </span>
                        <span className="mt-2 block text-xs leading-relaxed text-[#9bb0c3]">
                          {option.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </div>

            <div className="avl-card flex flex-col justify-between rounded-3xl p-5 sm:p-7">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#e4c36a]">
                  Request ticket
                </p>
                <h3 className="mt-2 text-xl font-semibold text-white">Veteran lead request</h3>
                <dl className="mt-5 space-y-3 text-sm">
                  <div className="flex justify-between gap-3 border-b border-white/10 pb-3">
                    <dt className="text-[#9bb0c3]">Lead type</dt>
                    <dd className="font-medium text-white">{summary.niche}</dd>
                  </div>
                  <div className="flex justify-between gap-3 border-b border-white/10 pb-3">
                    <dt className="text-[#9bb0c3]">Quantity</dt>
                    <dd className="font-medium text-white">{summary.quantity}</dd>
                  </div>
                  <div className="flex justify-between gap-3 border-b border-white/10 pb-3">
                    <dt className="text-[#9bb0c3]">Freshness</dt>
                    <dd className="text-right font-medium text-white">{summary.freshness}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#9bb0c3]">States</dt>
                    <dd className="max-w-[65%] text-right font-medium text-white">{summary.states}</dd>
                  </div>
                </dl>
                <p className="mt-5 rounded-xl border border-[#e4c36a]/25 bg-[#e4c36a]/10 px-3 py-2 text-xs leading-relaxed text-[#f8e7b0]">
                  {summary.chargeCopy}
                </p>
              </div>
              <Link
                href={continueHref}
                onClick={() => persistDraft()}
                className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-[#071422] hover:bg-[#f4f1ea]"
              >
                Sign in to submit this request
                <ArrowRight className="ml-2 size-4" aria-hidden />
              </Link>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-24 mt-16 space-y-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#e4c36a]">
              The path
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              From public page to released delivery
            </h2>
          </div>
          <ol className="grid gap-4 md:grid-cols-5">
            {steps.map((step, index) => (
              <li key={step.title} className="avl-card rounded-2xl p-4">
                <p className="text-xs font-semibold text-[#e4c36a]">0{index + 1}</p>
                <h3 className="mt-2 text-base font-semibold text-white">{step.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-[#9bb0c3]">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="get-started" className="scroll-mt-24 mt-16 grid gap-6 lg:grid-cols-2">
          <div className="avl-card rounded-3xl p-6 sm:p-8">
            <h2 className="text-2xl font-semibold text-white">Already have an invite?</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#b7c7d6]">
              Sign in with the email on your invite. If you still need to set a password, open the
              invite link you were sent — it starts at <span className="text-white">/portal/invite</span>.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                href={PUBLIC_PORTAL_SIGN_IN_HREF}
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#e4c36a] px-5 text-sm font-semibold text-[#071422] hover:bg-[#f3d98a]"
              >
                Sign in
              </Link>
              <Link
                href={PUBLIC_PORTAL_INVITE_HREF}
                onClick={() => persistDraft()}
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/20 px-5 text-sm font-semibold text-white hover:bg-white/5"
              >
                I have an invite
              </Link>
            </div>
          </div>

          <div className="avl-card rounded-3xl p-6 sm:p-8">
            <h2 className="text-2xl font-semibold text-white">Need an account?</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#b7c7d6]">
              Create an account with your work email. You will finish a short setup, then continue
              into your portal to submit a Veteran lead request. Payment confirmation and approval
              still stay with our team — this does not charge a card or start fulfillment.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-[#d7e3ee]">
              {[
                "No card form and no self-serve checkout on this page",
                "Submitted orders wait for payment confirmation and approval",
                "Released delivery shows up in your account — not a separate system",
              ].map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#e4c36a]" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href={PUBLIC_REGISTER_HREF}
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#e4c36a] px-5 text-sm font-semibold text-[#071422] hover:bg-[#f3d98a]"
              >
                Create account
              </Link>
              <a
                href="#preview"
                className="inline-flex min-h-12 items-center text-sm font-semibold text-[#e4c36a] underline-offset-4 hover:underline"
              >
                Preview a Veteran request first
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative border-t border-white/10 px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 text-sm text-[#9bb0c3] sm:flex-row sm:items-center sm:justify-between">
          <p>Aged Vet Leads · Veteran inventory for licensed insurance agents</p>
          <p>Orders are requests. Payment is confirmed by our team before fulfillment starts.</p>
        </div>
      </footer>
    </div>
  );
}
