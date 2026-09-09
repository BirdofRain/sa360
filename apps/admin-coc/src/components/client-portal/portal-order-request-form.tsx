"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SectionPanel } from "@/components/dashboard/section-panel";
import {
  formatPortalOrderRequestStates,
  mapPortalOrderCreateSuccess,
  optionLabel,
  parsePortalOrderCreateError,
  portalCustomerDestinationLabel,
  portalOrderRequestBlockedCopy,
  portalPaymentConfirmationLabel,
  serializePortalOrderCreateBody,
  shouldShowPortalOrderCrmPackageStep,
  shouldShowPortalOrderDestinationStep,
  validatePortalOrderRequestDraft,
  visiblePortalOrderDestinations,
  type PortalOrderCreateSuccessView,
  type PortalOrderRequestBlockedReason,
  type PortalOrderRequestCatalogs,
  type PortalOrderRequestDraft,
  type PortalOrderRequestFieldErrors,
} from "@/lib/client-portal/portal-order-request";
import {
  applyPublicLeadPrefillToDraft,
  clearPublicLeadPrefill,
  parsePublicLeadPrefillInput,
  publicFreshnessAgeBucketNotes,
  publicLeadPrefillHasValues,
  readPublicLeadPrefill,
  writePublicLeadPrefillFromParsed,
  type ParsedPublicLeadPrefill,
} from "@/lib/public-site/lead-request-handoff";
import { cn } from "@/lib/utils";

export type PortalOrderRequestSubmitResult =
  | { ok: true; item: PortalOrderCreateSuccessView }
  | { ok: false; error: string };

async function defaultSubmitOrder(
  body: Record<string, unknown>
): Promise<PortalOrderRequestSubmitResult> {
  const res = await fetch("/api/client-portal/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const error =
      json && typeof json === "object" && json !== null && "error" in json
        ? parsePortalOrderCreateError(JSON.stringify(json))
        : parsePortalOrderCreateError(text);
    return { ok: false, error };
  }
  const item = mapPortalOrderCreateSuccess(json);
  if (!item) return { ok: false, error: "We could not read the submitted order request." };
  return { ok: true, item };
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-700">{message}</p>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 break-words">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value}</dd>
    </div>
  );
}

export function PortalOrderRequestForm({
  eligible,
  blockedReason = "onboarding",
  catalogs,
  submitOrder = defaultSubmitOrder,
  previewUnavailableMessage,
  prefillSearch,
}: {
  eligible: boolean;
  blockedReason?: PortalOrderRequestBlockedReason;
  catalogs: PortalOrderRequestCatalogs;
  submitOrder?: (body: Record<string, unknown>) => Promise<PortalOrderRequestSubmitResult>;
  previewUnavailableMessage?: string;
  prefillSearch?: Record<string, unknown>;
}) {
  const urlPrefill = useMemo(
    () => parsePublicLeadPrefillInput(prefillSearch ?? {}),
    [prefillSearch]
  );
  const urlApplied = useMemo(
    () => applyPublicLeadPrefillToDraft(catalogs, urlPrefill),
    [catalogs, urlPrefill]
  );

  const [step, setStep] = useState<"form" | "review" | "success">("form");
  const [draft, setDraft] = useState<PortalOrderRequestDraft>(() => urlApplied.draft);
  const [prefillNotice, setPrefillNotice] = useState<{
    applied: boolean;
    dropped: string[];
    freshnessId: ParsedPublicLeadPrefill["freshnessId"];
  }>(() => ({
    applied: urlApplied.applied,
    dropped: urlApplied.dropped,
    freshnessId: urlApplied.freshnessId,
  }));
  const [stateQuery, setStateQuery] = useState("");
  const [errors, setErrors] = useState<PortalOrderRequestFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<PortalOrderCreateSuccessView | null>(null);

  useEffect(() => {
    if (urlApplied.applied) {
      writePublicLeadPrefillFromParsed(urlPrefill);
      return;
    }
    const stored = readPublicLeadPrefill();
    if (!publicLeadPrefillHasValues(stored)) return;
    const applied = applyPublicLeadPrefillToDraft(catalogs, stored);
    if (!applied.applied) return;
    setDraft(applied.draft);
    setPrefillNotice({
      applied: true,
      dropped: applied.dropped,
      freshnessId: applied.freshnessId,
    });
  }, [catalogs, urlApplied.applied, urlPrefill]);

  const visibleStates = useMemo(() => {
    const q = stateQuery.trim().toLowerCase();
    if (!q) return catalogs.states;
    return catalogs.states.filter(
      (state) =>
        state.value.toLowerCase().includes(q) || state.label.toLowerCase().includes(q)
    );
  }, [catalogs.states, stateQuery]);

  if (!eligible) {
    const copy = portalOrderRequestBlockedCopy(blockedReason);
    return (
      <SectionPanel>
        <div className="space-y-3 px-4 py-8 text-center sm:px-6">
          <h2 className="text-lg font-semibold text-slate-900">{copy.title}</h2>
          <p className="text-sm text-slate-600">{copy.message}</p>
          <div className="flex min-w-0 flex-col items-center gap-2 sm:flex-row sm:justify-center">
            {copy.accountActionLabel ? (
              <Link
                href="/portal/account"
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-slate-900 px-3 text-sm font-medium text-white"
              >
                {copy.accountActionLabel}
              </Link>
            ) : (
              <Link
                href="/portal/account"
                className="inline-flex min-h-10 items-center justify-center text-sm font-medium text-slate-800 underline-offset-2 hover:underline"
              >
                Back to account
              </Link>
            )}
            <Link
              href="/portal/orders"
              className="inline-flex min-h-10 items-center justify-center text-sm font-medium text-slate-800 underline-offset-2 hover:underline"
            >
              Back to orders
            </Link>
          </div>
        </div>
      </SectionPanel>
    );
  }

  function update<K extends keyof PortalOrderRequestDraft>(
    key: K,
    value: PortalOrderRequestDraft[K]
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function toggleState(code: string) {
    setDraft((current) => {
      const selected = current.states.includes(code)
        ? current.states.filter((state) => state !== code)
        : current.states.length >= 20
          ? current.states
          : [...current.states, code];
      return { ...current, states: selected };
    });
  }

  function handleReview() {
    const nextErrors = validatePortalOrderRequestDraft(draft, catalogs);
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0) return;
    setStep("review");
  }

  async function handleSubmit() {
    const nextErrors = validatePortalOrderRequestDraft(draft, catalogs);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setStep("form");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (previewUnavailableMessage) {
        setSubmitError(previewUnavailableMessage);
        return;
      }
      const body = serializePortalOrderCreateBody(draft, catalogs);
      const result = await submitOrder(body);
      if (!result.ok) {
        setSubmitError(result.error);
        return;
      }
      setCreated(result.item);
      setStep("success");
      clearPublicLeadPrefill();
    } catch {
      setSubmitError("We could not submit your order request. Try again shortly.");
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "success" && created) {
    const paymentLabel = portalPaymentConfirmationLabel(created.paymentConfirmationStatus);
    const ageBucket = publicFreshnessAgeBucketNotes(prefillNotice.freshnessId);
    const freshnessLabel = optionLabel(catalogs.campaignTypes, draft.campaignType);
    return (
      <SectionPanel>
        <div className="min-w-0 space-y-5 px-4 py-6 sm:px-6">
          <div className="space-y-2">
            <p className="inline-flex w-fit rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-amber-900">
              Submitted for review
            </p>
            <h2 className="text-lg font-semibold text-slate-900">Order request received</h2>
            <p className="text-sm text-slate-600">
              Request <span className="font-semibold text-slate-900">{created.orderNumber}</span> is
              submitted for review. Nothing is billed or released from this page.
            </p>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            <SummaryRow label="Order number" value={created.orderNumber} />
            <SummaryRow label="Status" value="Submitted for review" />
            <SummaryRow
              label="Lead type"
              value={optionLabel(catalogs.nicheKeys, draft.nicheKey)}
            />
            <SummaryRow label="Quantity" value={draft.leadVolume.toLocaleString()} />
            <SummaryRow label="States" value={formatPortalOrderRequestStates(draft.states)} />
            <SummaryRow
              label="Freshness"
              value={ageBucket ? `${freshnessLabel} · ${ageBucket.replace("Requested age bucket: ", "")}` : freshnessLabel}
            />
            {paymentLabel ? (
              <SummaryRow label="Payment" value={paymentLabel} />
            ) : (
              <SummaryRow label="Payment" value="Payment pending" />
            )}
          </dl>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 sm:px-4">
            <h3 className="text-sm font-semibold text-slate-900">What happens next</h3>
            <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-sm text-slate-600">
              <li>Your SA360 team confirms payment outside this portal.</li>
              <li>They approve the request before fulfillment starts.</li>
              <li>Released leads appear in this account when the package is ready.</li>
            </ol>
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Link
              href={`/portal/orders/${encodeURIComponent(created.id)}`}
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-slate-900 px-3 text-sm font-medium text-white"
            >
              View order
            </Link>
            <Link
              href="/portal/account"
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-800"
            >
              Go to your account
            </Link>
            <Link
              href="/portal/orders"
              className="inline-flex min-h-10 items-center justify-center text-sm font-medium text-slate-800 underline-offset-2 hover:underline"
            >
              Back to orders
            </Link>
          </div>
        </div>
      </SectionPanel>
    );
  }

  if (step === "review") {
    return (
      <SectionPanel title="Review request">
        <div className="min-w-0 space-y-4 px-4 py-4 sm:px-6">
          <dl className="grid gap-3 sm:grid-cols-2">
            <SummaryRow
              label="Lead type"
              value={optionLabel(catalogs.nicheKeys, draft.nicheKey)}
            />
            <SummaryRow label="Quantity" value={draft.leadVolume.toLocaleString()} />
            <SummaryRow label="States" value={formatPortalOrderRequestStates(draft.states)} />
            {draft.productType ? (
              <SummaryRow
                label="Product"
                value={optionLabel(catalogs.productTypes, draft.productType)}
              />
            ) : null}
            <SummaryRow
              label="Freshness"
              value={optionLabel(catalogs.campaignTypes, draft.campaignType)}
            />
            {publicFreshnessAgeBucketNotes(prefillNotice.freshnessId) ? (
              <SummaryRow
                label="Age bucket"
                value={publicFreshnessAgeBucketNotes(prefillNotice.freshnessId)!.replace(
                  "Requested age bucket: ",
                  ""
                )}
              />
            ) : null}
            <SummaryRow
              label="Delivery"
              value={portalCustomerDestinationLabel(draft.deliveryDestinationLabel)}
            />
            {draft.notes.trim() ? <SummaryRow label="Notes" value={draft.notes.trim()} /> : null}
          </dl>
          {submitError ? (
            <p role="alert" className="text-sm text-red-700">
              {submitError}
            </p>
          ) : null}
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              className="min-h-10 w-full sm:w-auto"
              disabled={submitting}
              onClick={() => void handleSubmit()}
            >
              {submitting ? "Submitting…" : "Submit order request"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-10 w-full sm:w-auto"
              disabled={submitting}
              onClick={() => setStep("form")}
            >
              Back to form
            </Button>
          </div>
        </div>
      </SectionPanel>
    );
  }

  const atStateLimit = draft.states.length >= 20;
  const showCrmPackage = shouldShowPortalOrderCrmPackageStep();
  const destinationOptions = visiblePortalOrderDestinations(catalogs);
  const showDestination = shouldShowPortalOrderDestinationStep(catalogs);

  return (
    <SectionPanel title="Configure request">
      <form
        className="min-w-0 space-y-4 overflow-x-hidden px-4 py-4 sm:px-6"
        onSubmit={(event) => {
          event.preventDefault();
          handleReview();
        }}
      >
        {prefillNotice.applied ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
            <p>
              Your Aged Vet Leads preview is filled in below. Review it, then submit the request.
              Nothing is reserved until you submit.
            </p>
            {prefillNotice.dropped.length > 0 ? (
              <p className="mt-1 text-xs text-slate-500">
                Some preview values were not valid for this account and were left blank.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="order-niche">Lead type</Label>
            <Select
              id="order-niche"
              value={draft.nicheKey}
              onChange={(event) => update("nicheKey", event.target.value)}
            >
              {catalogs.nicheKeys.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <FieldError message={errors.nicheKey} />
          </div>

          {catalogs.productTypes.length > 0 ? (
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="order-product">Product</Label>
              <Select
                id="order-product"
                value={draft.productType}
                onChange={(event) => update("productType", event.target.value)}
              >
                {catalogs.productTypes.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <FieldError message={errors.productType} />
            </div>
          ) : null}

          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="order-quantity">Quantity</Label>
            <Input
              id="order-quantity"
              type="number"
              min={1}
              max={1_000_000}
              value={draft.leadVolume}
              onChange={(event) => update("leadVolume", Number(event.target.value))}
            />
            <FieldError message={errors.leadVolume} />
          </div>

          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="order-freshness">Freshness</Label>
            <Select
              id="order-freshness"
              value={draft.campaignType}
              onChange={(event) => update("campaignType", event.target.value)}
            >
              {catalogs.campaignTypes.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <FieldError message={errors.campaignType} />
          </div>

          {showCrmPackage ? (
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="order-crm">CRM</Label>
              <Select
                id="order-crm"
                value={draft.crmPackage}
                onChange={(event) => update("crmPackage", event.target.value)}
              >
                {catalogs.crmPackages.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <FieldError message={errors.crmPackage} />
            </div>
          ) : null}
        </div>

        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor="order-state-search">States</Label>
          <Input
            id="order-state-search"
            value={stateQuery}
            placeholder="Find a state"
            onChange={(event) => setStateQuery(event.target.value)}
          />
          {draft.states.length > 0 ? (
            <p className="text-xs text-slate-500">
              Selected: {formatPortalOrderRequestStates(draft.states)}
            </p>
          ) : null}
          <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto overflow-x-hidden sm:grid-cols-3">
            {visibleStates.map((state) => {
              const selected = draft.states.includes(state.value);
              const disabled = !selected && atStateLimit;
              return (
                <label
                  key={state.value}
                  className={cn(
                    "flex min-h-10 min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-xs",
                    selected
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-800",
                    disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={selected}
                    disabled={disabled}
                    onChange={() => toggleState(state.value)}
                  />
                  <span className="min-w-0 truncate">{state.label}</span>
                </label>
              );
            })}
          </div>
          <FieldError message={errors.states} />
        </div>

        {showDestination ? (
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="order-destination">Delivery destination</Label>
            <Select
              id="order-destination"
              value={draft.deliveryDestinationLabel}
              onChange={(event) => update("deliveryDestinationLabel", event.target.value)}
            >
              {destinationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <FieldError message={errors.deliveryDestinationLabel} />
          </div>
        ) : null}

        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor="order-notes">Notes (optional)</Label>
          <Textarea
            id="order-notes"
            rows={3}
            maxLength={2000}
            placeholder="Anything your SA360 team should know"
            value={draft.notes}
            onChange={(event) => update("notes", event.target.value)}
          />
          <FieldError message={errors.notes} />
        </div>

        <Button type="submit" className="min-h-10 w-full sm:w-auto">
          Review request
        </Button>
      </form>
    </SectionPanel>
  );
}
