"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SectionPanel } from "@/components/dashboard/section-panel";
import {
  applyPortalFreshnessChange,
  formatPortalOrderRequestStates,
  mapPortalOrderCreateSuccess,
  optionLabel,
  parsePortalOrderCreateError,
  portalCustomerDestinationLabel,
  portalOrderEstimateCopy,
  portalComingSoonCopy,
  portalOrderRequestBlockedCopy,
  portalPaymentConfirmationLabel,
  PORTAL_COMING_SOON_NOTIFY_LABEL,
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
  PORTAL_ORDER_ESTIMATE_DISCLAIMER,
  PORTAL_ORDER_SHORTFALL_DISCLAIMER,
  formatPortalUsdFromCents,
  isAgedCampaignType,
  portalAgedBucketLabel,
  portalAgedBucketOptions,
  portalShortfallPolicyLabel,
} from "@/lib/client-portal/portal-aged-order-options";
import { isComingSoonCampaignType } from "@sa360/shared";
import {
  applyPublicLeadPrefillToDraft,
  clearPublicLeadPrefill,
  parsePublicLeadPrefillInput,
  publicLeadPrefillHasValues,
  readPublicLeadPrefill,
  writePublicLeadPrefillFromParsed,
  type ParsedPublicLeadPrefill,
} from "@/lib/public-site/lead-request-handoff";
import { PortalOrderBucketLines } from "@/components/client-portal/portal-order-bucket-lines";
import {
  buyerEstimateSignature,
  buyerEstimatesFromAvailabilityPayload,
  changedBuyerBucketLabels,
  clearPortalOrderDraftPersistence,
  estimatePortalOrderLines,
  formatPortalBuyerEstimate,
  newPortalOrderIdempotencyKey,
  portalLineQuantityTotal,
  portalLinesFromQuantities,
  portalOrderCommercialSignature,
  readPortalOrderDraftPersistence,
  writePortalOrderDraftPersistence,
  type PortalBuyerBucketEstimate,
  type PortalLineEstimateRow,
} from "@/lib/client-portal/portal-live-order";
import { cn } from "@/lib/utils";

const PortalOrderInventoryMap = dynamic(
  () =>
    import("@/components/client-portal/portal-order-inventory-map").then(
      (module) => module.PortalOrderInventoryMap
    ),
  { ssr: false }
);

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

function MultiBucketSummary({
  rows,
  totalLabel,
}: {
  rows: readonly PortalLineEstimateRow[];
  totalLabel: string;
}) {
  return (
    <>
      <div className="min-w-0 break-words sm:col-span-2">
        <p className="text-xs text-slate-500">Age buckets</p>
        <ul className="mt-1 space-y-1 text-sm text-slate-900">
          {rows.map((row) => (
            <li key={row.commerceAgeBucketKey}>
              {row.label} · {row.requestedQuantity.toLocaleString()} · {row.unitPriceLabel}
              {row.lineTotalCents != null ? ` · ${row.lineTotalLabel}` : ""}
            </li>
          ))}
        </ul>
      </div>
      <SummaryRow label="Estimated total" value={totalLabel} />
    </>
  );
}

export function PortalOrderRequestForm({
  eligible,
  blockedReason = "onboarding",
  catalogs,
  submitOrder = defaultSubmitOrder,
  previewUnavailableMessage,
  prefillSearch,
  inventoryMapEnabled = false,
  liveInventoryEnabled = false,
  multiBucketEnabled = false,
}: {
  eligible: boolean;
  blockedReason?: PortalOrderRequestBlockedReason;
  catalogs: PortalOrderRequestCatalogs;
  submitOrder?: (body: Record<string, unknown>) => Promise<PortalOrderRequestSubmitResult>;
  previewUnavailableMessage?: string;
  prefillSearch?: Record<string, unknown>;
  inventoryMapEnabled?: boolean;
  liveInventoryEnabled?: boolean;
  multiBucketEnabled?: boolean;
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
  const [estimates, setEstimates] = useState<Record<string, PortalBuyerBucketEstimate>>({});
  const [evaluatedAt, setEvaluatedAt] = useState<string | null>(null);
  const [availabilityNote, setAvailabilityNote] = useState<string | null>(null);
  const [availabilitySignature, setAvailabilitySignature] = useState<string | null>(null);
  const [acknowledgedSignature, setAcknowledgedSignature] = useState<string | null>(null);
  const [adjustmentLabels, setAdjustmentLabels] = useState<string[]>([]);
  const estimateRef = useRef<PortalBuyerBucketEstimate[]>([]);
  const signatureRef = useRef<string | null>(null);
  const commercialRef = useRef<string | null>(null);
  const availabilityRequestRef = useRef(0);
  const orderOptions = useMemo(() => ({ multiBucketEnabled }), [multiBucketEnabled]);

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

  const selectedLines = portalLinesFromQuantities(draft.lineQuantities);
  const lineEstimate = estimatePortalOrderLines(selectedLines);
  const commercialSignature = portalOrderCommercialSignature({
    nicheKey: draft.nicheKey,
    states: draft.states,
    shortfallPolicy: draft.shortfallPolicy,
    lines: selectedLines,
  });

  useEffect(() => {
    if (!multiBucketEnabled) return;
    const stored = readPortalOrderDraftPersistence();
    setDraft((current) => {
      if (!stored) {
        return current.idempotencyKey
          ? current
          : { ...current, idempotencyKey: newPortalOrderIdempotencyKey() };
      }
      const lines = portalLinesFromQuantities(stored.lineQuantities);
      const total = portalLineQuantityTotal(lines);
      return {
        ...current,
        lineQuantities: stored.lineQuantities,
        inspectAgeBucket: stored.inspectAgeBucket,
        idempotencyKey: stored.idempotencyKey || newPortalOrderIdempotencyKey(),
        leadVolume: total > 0 ? total : current.leadVolume,
        requestedAgeBucket:
          lines.length === 1
            ? lines[0]!.commerceAgeBucketKey
            : stored.inspectAgeBucket ?? current.requestedAgeBucket,
      };
    });
    commercialRef.current = stored?.commercialSignature || null;
  }, [multiBucketEnabled]);

  useEffect(() => {
    if (!multiBucketEnabled) return;
    if (commercialRef.current == null) {
      commercialRef.current = commercialSignature;
    } else if (commercialRef.current !== commercialSignature) {
      commercialRef.current = commercialSignature;
      setDraft((current) => ({ ...current, idempotencyKey: newPortalOrderIdempotencyKey() }));
    }
    writePortalOrderDraftPersistence({
      lineQuantities: draft.lineQuantities ?? {},
      inspectAgeBucket: draft.inspectAgeBucket ?? draft.requestedAgeBucket,
      idempotencyKey: draft.idempotencyKey ?? "",
      commercialSignature,
    });
  }, [
    commercialSignature,
    draft.idempotencyKey,
    draft.inspectAgeBucket,
    draft.lineQuantities,
    draft.requestedAgeBucket,
    multiBucketEnabled,
  ]);

  const refreshBuyerAvailability = useCallback(
    async (
      signal?: AbortSignal
    ): Promise<
      | { status: "skipped" | "stale" }
      | { status: "current" | "changed"; labels: string[] }
    > => {
      if (!liveInventoryEnabled || !isAgedCampaignType(draft.campaignType)) {
        return { status: "skipped" };
      }
      const bucketKeys = portalAgedBucketOptions().map((option) => option.value);
      const requestId = ++availabilityRequestRef.current;
      const publish = (
        next: PortalBuyerBucketEstimate[],
        evaluated: string | null,
        note: string
      ): { status: "current" | "changed" | "stale"; labels: string[] } => {
        if (signal?.aborted || requestId !== availabilityRequestRef.current) {
          return { status: "stale", labels: [] };
        }
        const signature = buyerEstimateSignature(next);
        const labels =
          signatureRef.current && signatureRef.current !== signature
            ? changedBuyerBucketLabels(estimateRef.current, next)
            : [];
        if (labels.length > 0) {
          setAdjustmentLabels(labels);
          setAcknowledgedSignature(null);
        }
        signatureRef.current = signature;
        estimateRef.current = next;
        setAvailabilitySignature(signature);
        setEstimates(Object.fromEntries(next.map((bucket) => [bucket.commerceAgeBucketKey, bucket])));
        setEvaluatedAt(evaluated);
        setAvailabilityNote(note);
        return { status: labels.length > 0 ? "changed" : "current", labels };
      };
      const unknownBuckets = (display: "unknown" | "unavailable"): PortalBuyerBucketEstimate[] =>
        bucketKeys.map((commerceAgeBucketKey) => ({
          commerceAgeBucketKey,
          eligible: null,
          display,
        }));

      if (draft.productType.trim()) {
        return publish(
          unknownBuckets("unknown"),
          null,
          "Product filters are not included in buyer-eligible counts, so availability stays unknown."
        );
      }
      if (!draft.nicheKey || draft.states.length === 0) {
        if (!signatureRef.current) {
          setAvailabilityNote("Select at least one state to check buyer-eligible availability.");
          return { status: "current", labels: [] };
        }
        return publish(
          unknownBuckets("unknown"),
          null,
          "Select at least one state to check buyer-eligible availability."
        );
      }

      try {
        const response = await fetch("/api/client-portal/inventory/buyer-availability", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          signal,
          body: JSON.stringify({
            nicheKey: draft.nicheKey,
            states: draft.states,
            commerceAgeBucketKeys: bucketKeys,
          }),
        });
        if (!response.ok) throw new Error("unavailable");
        const payload: unknown = await response.json();
        const parsed = buyerEstimatesFromAvailabilityPayload(payload, bucketKeys);
        if (!parsed) throw new Error("unavailable");
        const returnedStates = [...parsed.states].sort().join(",");
        if (
          parsed.nicheKey !== draft.nicheKey ||
          returnedStates !== [...draft.states].sort().join(",")
        ) {
          return { status: "stale" };
        }
        return publish(
          parsed.estimates,
          parsed.evaluatedAt,
          "Availability is an estimate for this snapshot and does not reserve inventory."
        );
      } catch (caught: unknown) {
        if (signal?.aborted || (caught instanceof DOMException && caught.name === "AbortError")) {
          return { status: "stale" };
        }
        return publish(
          unknownBuckets("unavailable"),
          null,
          "Buyer-eligible availability is unavailable. Your quantities were kept."
        );
      }
    },
    [draft.campaignType, draft.nicheKey, draft.productType, draft.states, liveInventoryEnabled]
  );

  useEffect(() => {
    if (!liveInventoryEnabled || !isAgedCampaignType(draft.campaignType)) return;
    const controller = new AbortController();
    void refreshBuyerAvailability(controller.signal);
    return () => controller.abort();
  }, [draft.campaignType, liveInventoryEnabled, refreshBuyerAvailability]);

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
    setDraft((current) => {
      if (key === "campaignType") {
        return applyPortalFreshnessChange(current, String(value));
      }
      if (key === "readySmsOptIn" && value === false) {
        return { ...current, readySmsOptIn: false, readySmsPhone: "" };
      }
      return { ...current, [key]: value };
    });
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

  function syncLineDraft(
    quantities: Record<string, number>,
    inspectAgeBucket: string | null
  ) {
    const lines = portalLinesFromQuantities(quantities);
    const total = portalLineQuantityTotal(lines);
    setDraft((current) => ({
      ...current,
      lineQuantities: quantities,
      inspectAgeBucket,
      leadVolume: total > 0 ? total : current.leadVolume,
      requestedAgeBucket:
        lines.length === 1 ? lines[0]!.commerceAgeBucketKey : inspectAgeBucket ?? current.requestedAgeBucket,
    }));
  }

  function handleReview() {
    const nextErrors = validatePortalOrderRequestDraft(draft, catalogs, orderOptions);
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0) return;
    setStep("review");
  }

  async function handleSubmit() {
    const nextErrors = validatePortalOrderRequestDraft(draft, catalogs, orderOptions);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setStep("form");
      return;
    }
    if (
      liveInventoryEnabled &&
      isAgedCampaignType(draft.campaignType) &&
      adjustmentLabels.length > 0 &&
      acknowledgedSignature !== availabilitySignature
    ) {
      setSubmitError(
        "Review the updated availability estimate before submitting. Your quantities were not changed."
      );
      setStep("form");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (liveInventoryEnabled && isAgedCampaignType(draft.campaignType)) {
        const refresh = await refreshBuyerAvailability();
        if (refresh.status === "stale") {
          setSubmitError(
            "Availability is still updating for the current filters. Review the estimate, then submit again."
          );
          setStep("form");
          return;
        }
        if (refresh.status === "changed") {
          const which = refresh.labels.length > 0 ? refresh.labels.join(", ") : "one or more age buckets";
          setSubmitError(
            `Availability changed for ${which}. Your quantities were not changed. Review the estimate before submitting.`
          );
          setStep("form");
          return;
        }
      }
      if (previewUnavailableMessage) {
        setSubmitError(previewUnavailableMessage);
        return;
      }
      const body = serializePortalOrderCreateBody(draft, catalogs, orderOptions);
      const result = await submitOrder(body);
      if (!result.ok) {
        setSubmitError(result.error);
        return;
      }
      setCreated(result.item);
      setStep("success");
      clearPublicLeadPrefill();
      clearPortalOrderDraftPersistence();
    } catch {
      setSubmitError("We could not submit your order request. Try again shortly.");
    } finally {
      setSubmitting(false);
    }
  }

  const multiLineReview = multiBucketEnabled && lineEstimate.rows.length > 0;
  const multiLineTotalLabel =
    lineEstimate.pending || lineEstimate.totalCents == null
      ? "Price confirmed during review"
      : formatPortalUsdFromCents(lineEstimate.totalCents);

  if (step === "success" && created) {
    const paymentLabel = portalPaymentConfirmationLabel(created.paymentConfirmationStatus);
    const freshnessLabel = optionLabel(catalogs.campaignTypes, draft.campaignType);
    const ageBucketLabel = portalAgedBucketLabel(draft.requestedAgeBucket);
    const estimate = portalOrderEstimateCopy(draft);
    const comingSoon = isComingSoonCampaignType(draft.campaignType);
    return (
      <SectionPanel>
        <div className="min-w-0 space-y-5 px-4 py-6 sm:px-6">
          <div className="space-y-2">
            <p className="inline-flex w-fit rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-amber-900">
              Submitted for review
            </p>
            <h2 className="text-lg font-semibold text-slate-900">
              {comingSoon ? "Interest request received" : "Order request received"}
            </h2>
            <p className="text-sm text-slate-600">
              Request <span className="font-semibold text-slate-900">{created.orderNumber}</span>{" "}
              {comingSoon
                ? "is saved as an interest request. Nothing is reserved, priced, or released from this page."
                : "is submitted for review. Nothing is billed or released from this page."}
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
              value={freshnessLabel}
            />
            {multiLineReview ? (
              <MultiBucketSummary rows={lineEstimate.rows} totalLabel={multiLineTotalLabel} />
            ) : isAgedCampaignType(draft.campaignType) && ageBucketLabel ? (
              <SummaryRow label="Age bucket" value={ageBucketLabel} />
            ) : null}
            {!multiLineReview && isAgedCampaignType(draft.campaignType) ? (
              <>
                <SummaryRow
                  label="Estimated rate"
                  value={estimate.pending ? estimate.totalLabel : estimate.rateLabel ?? estimate.totalLabel}
                />
                <SummaryRow label="Estimated total" value={estimate.totalLabel} />
              </>
            ) : null}
            {comingSoon ? (
              <SummaryRow label="Notify when available" value="Yes" />
            ) : null}
            {paymentLabel ? (
              <SummaryRow label="Payment" value={paymentLabel} />
            ) : (
              <SummaryRow label="Payment" value="Payment pending" />
            )}
          </dl>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 sm:px-4">
            <h3 className="text-sm font-semibold text-slate-900">What happens next</h3>
            {comingSoon ? (
              <p className="mt-2 text-sm text-slate-600">
                We&apos;ll let you know when this becomes available. This request will not be fulfilled
                as an aged lead order.
              </p>
            ) : (
              <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-sm text-slate-600">
                <li>Your SA360 team confirms payment outside this portal.</li>
                <li>They approve the request before fulfillment starts.</li>
                <li>Released leads appear in this account when the package is ready.</li>
              </ol>
            )}
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
    const estimate = portalOrderEstimateCopy(draft);
    const ageBucketLabel = portalAgedBucketLabel(draft.requestedAgeBucket);
    const aged = isAgedCampaignType(draft.campaignType);
    const comingSoon = isComingSoonCampaignType(draft.campaignType);
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
            {multiLineReview ? (
              <MultiBucketSummary rows={lineEstimate.rows} totalLabel={multiLineTotalLabel} />
            ) : aged && ageBucketLabel ? (
              <SummaryRow label="Age bucket" value={ageBucketLabel} />
            ) : null}
            {comingSoon ? (
              <>
                <SummaryRow label="Availability" value="Interest / Coming soon" />
                <SummaryRow label="Notify when available" value="Yes" />
              </>
            ) : null}
            {aged && !multiLineReview ? (
              <>
                <SummaryRow
                  label="Estimated rate"
                  value={estimate.pending ? estimate.totalLabel : estimate.rateLabel ?? estimate.totalLabel}
                />
                <SummaryRow label="Estimated total" value={estimate.totalLabel} />
              </>
            ) : null}
            {aged && draft.shortfallPolicy ? (
              <SummaryRow
                label="Shortfall preference"
                value={portalShortfallPolicyLabel(draft.shortfallPolicy)}
              />
            ) : null}
            {aged ? (
              <SummaryRow
                label="Ready text"
                value={
                  draft.readySmsOptIn && draft.readySmsPhone.trim()
                    ? `Yes — ${draft.readySmsPhone.trim()}`
                    : "No"
                }
              />
            ) : null}
            <SummaryRow
              label="Delivery"
              value={portalCustomerDestinationLabel(draft.deliveryDestinationLabel)}
            />
            {draft.notes.trim() ? <SummaryRow label="Notes" value={draft.notes.trim()} /> : null}
          </dl>
          <p className="text-xs text-slate-500">
            {comingSoon
              ? "This is an interest request. Nothing is reserved or billed, and aged lead fulfillment will not start from this request."
              : "This is a request. Inventory is not reserved until your SA360 team reviews and approves it. Fulfillment begins after that approval."}
          </p>
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
              {submitting
                ? "Submitting…"
                : comingSoon
                  ? "Submit interest request"
                  : "Submit order request"}
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
  const estimate = portalOrderEstimateCopy(draft);
  const aged = isAgedCampaignType(draft.campaignType);
  const comingSoon = isComingSoonCampaignType(draft.campaignType);
  const comingSoonCopy = portalComingSoonCopy(draft.campaignType);

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

          {multiBucketEnabled && isAgedCampaignType(draft.campaignType) ? (
            <div className="grid min-w-0 gap-1.5">
              <p className="text-sm font-medium text-slate-900">Combined quantity</p>
              <p className="text-sm text-slate-800" data-testid="portal-combined-quantity">
                {lineEstimate.quantity.toLocaleString()}
              </p>
              <FieldError message={errors.leadVolume} />
            </div>
          ) : (
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
          )}

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

          {isAgedCampaignType(draft.campaignType) && multiBucketEnabled ? (
            <PortalOrderBucketLines
              quantities={draft.lineQuantities ?? {}}
              inspectAgeBucket={draft.inspectAgeBucket ?? draft.requestedAgeBucket}
              estimates={estimates}
              rows={lineEstimate.rows}
              evaluatedAt={liveInventoryEnabled ? evaluatedAt : null}
              availabilityNote={liveInventoryEnabled ? availabilityNote : null}
              adjustmentLabels={adjustmentLabels}
              acknowledged={acknowledgedSignature === availabilitySignature && availabilitySignature != null}
              onToggle={(bucket, selected) => {
                const next = { ...(draft.lineQuantities ?? {}) };
                if (selected) next[bucket] = next[bucket] && next[bucket] > 0 ? next[bucket] : 100;
                else delete next[bucket];
                syncLineDraft(next, draft.inspectAgeBucket ?? bucket);
              }}
              onQuantity={(bucket, quantity) => {
                const next = { ...(draft.lineQuantities ?? {}), [bucket]: quantity };
                syncLineDraft(next, draft.inspectAgeBucket ?? bucket);
              }}
              onInspect={(bucket) => syncLineDraft(draft.lineQuantities ?? {}, bucket)}
              onAcknowledge={(checked) =>
                setAcknowledgedSignature(checked ? availabilitySignature : null)
              }
            />
          ) : isAgedCampaignType(draft.campaignType) ? (
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="order-age-bucket">Age bucket</Label>
              <Select
                id="order-age-bucket"
                value={draft.requestedAgeBucket ?? ""}
                onChange={(event) =>
                  update("requestedAgeBucket", event.target.value || null)
                }
              >
                <option value="">Select an age bucket</option>
                {portalAgedBucketOptions().map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              {liveInventoryEnabled && draft.requestedAgeBucket ? (
                <p className="text-xs text-slate-600">
                  Buyer-eligible estimate:{" "}
                  {formatPortalBuyerEstimate(estimates[draft.requestedAgeBucket])}
                  {evaluatedAt ? ` · checked ${new Date(evaluatedAt).toLocaleString()}` : ""}
                  . This estimate does not reserve inventory.
                </p>
              ) : null}
              <FieldError message={errors.requestedAgeBucket} />
            </div>
          ) : null}

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

        {comingSoon && comingSoonCopy ? (
          <div
            className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 sm:px-4"
            data-testid="portal-coming-soon"
          >
            <p className="text-sm font-semibold text-slate-900">Coming soon</p>
            <p className="mt-1 text-sm text-slate-700">{comingSoonCopy}</p>
            <label className="mt-3 flex min-h-10 cursor-pointer items-start gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                className="mt-1"
                checked={draft.notifyWhenAvailable}
                onChange={(event) => update("notifyWhenAvailable", event.target.checked)}
              />
              <span>{PORTAL_COMING_SOON_NOTIFY_LABEL}</span>
            </label>
            <FieldError message={errors.notifyWhenAvailable} />
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 sm:px-4">
            {multiBucketEnabled && aged ? (
              <>
                <p className="text-sm font-semibold text-slate-900">
                  Estimated order total:{" "}
                  {lineEstimate.pending || lineEstimate.totalCents == null
                    ? "Price confirmed during review"
                    : `$${(lineEstimate.totalCents / 100).toFixed(lineEstimate.totalCents % 100 === 0 ? 0 : 2)}`}
                </p>
                <p className="mt-0.5 text-sm text-slate-600">
                  {lineEstimate.quantity.toLocaleString()} leads across {lineEstimate.rows.length}{" "}
                  age {lineEstimate.rows.length === 1 ? "bucket" : "buckets"}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-slate-900">
                  Estimated order total: {estimate.totalLabel}
                </p>
                {estimate.rateLabel ? (
                  <p className="mt-0.5 text-sm text-slate-600">{estimate.rateLabel}</p>
                ) : null}
              </>
            )}
            <p className="mt-2 text-xs text-slate-500">{PORTAL_ORDER_ESTIMATE_DISCLAIMER}</p>
            {liveInventoryEnabled && availabilityNote ? (
              <p className="mt-1 text-xs text-slate-500">{availabilityNote}</p>
            ) : null}
            {multiBucketEnabled && aged ? <FieldError message={errors.requestedAgeBucket} /> : null}
          </div>
        )}

        {aged ? (
          <fieldset className="grid min-w-0 gap-2">
            <legend className="text-sm font-medium text-slate-900">
              If we can&apos;t fully fill this age bucket:
            </legend>
            <label className="flex min-h-10 cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
              <input
                type="radio"
                className="mt-1"
                name="order-shortfall"
                checked={draft.shortfallPolicy === "REFUND_UNFILLED"}
                onChange={() => update("shortfallPolicy", "REFUND_UNFILLED")}
              />
              <span>Refund or credit any unfilled leads</span>
            </label>
            <label className="flex min-h-10 cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
              <input
                type="radio"
                className="mt-1"
                name="order-shortfall"
                checked={draft.shortfallPolicy === "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT"}
                onChange={() =>
                  update("shortfallPolicy", "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT")
                }
              />
              <span>{portalShortfallPolicyLabel("ALLOW_OLDER_WITH_PRICE_ADJUSTMENT")}</span>
            </label>
            <FieldError message={errors.shortfallPolicy} />
            <p className="text-xs text-slate-500">{PORTAL_ORDER_SHORTFALL_DISCLAIMER}</p>
          </fieldset>
        ) : null}

        {inventoryMapEnabled && aged ? (
          <div className="grid min-w-0 gap-1.5">
            <PortalOrderInventoryMap
              states={catalogs.states}
              selectedStates={draft.states}
              onToggleState={toggleState}
              maxSelectedStates={20}
              nicheKey={draft.nicheKey}
              productType={draft.productType}
              requestedAgeBucket={
                multiBucketEnabled
                  ? draft.inspectAgeBucket ?? draft.requestedAgeBucket
                  : draft.requestedAgeBucket
              }
              requestedQuantity={Math.max(draft.leadVolume, 1)}
              availabilityMode={liveInventoryEnabled ? "buyer-unknown" : "operational"}
              inspectBucketLabel={
                multiBucketEnabled
                  ? portalAgedBucketLabel(draft.inspectAgeBucket ?? draft.requestedAgeBucket)
                  : liveInventoryEnabled
                    ? portalAgedBucketLabel(draft.requestedAgeBucket)
                    : null
              }
            />
            <FieldError message={errors.states} />
          </div>
        ) : (
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
        )}

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

        {aged ? (
        <div className="grid min-w-0 gap-2">
          <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={draft.readySmsOptIn}
              onChange={(event) => update("readySmsOptIn", event.target.checked)}
            />
            Text me when this order is ready
          </label>
          {draft.readySmsOptIn ? (
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="order-sms-phone">Mobile number</Label>
              <Input
                id="order-sms-phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="(555) 123-4567"
                value={draft.readySmsPhone}
                onChange={(event) => update("readySmsPhone", event.target.value)}
              />
              <FieldError message={errors.readySmsPhone} />
            </div>
          ) : null}
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
