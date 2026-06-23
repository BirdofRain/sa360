"use client";

import { useEffect, useState, useTransition } from "react";

import { updateRoutingDryRunValidationAction } from "@/app/actions/routing-dry-run";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RoutingDryRunDecisionItem, RoutingDryRunValidationPatchBody } from "@/lib/routing-dry-run/types";
import { formatRoutingDryRunActionError } from "@/lib/routing-dry-run/routing-dry-run-action.util";
import { buildRoutingComparisonSummary } from "@/lib/routing-dry-run/routing-dry-run-comparison";
import {
  ROUTING_VALIDATION_STATUS_OPTIONS,
  effectiveValidationStatus,
} from "@/lib/routing-dry-run/routing-dry-run-validation-display";
import { copyTextToClipboard } from "@/lib/webhook-monitor-detail.utils";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const FORM_VALIDATION_OPTIONS = ROUTING_VALIDATION_STATUS_OPTIONS.filter((o) => o.value !== "all");

const QUICK_STATUSES: Array<{ status: RoutingDryRunValidationPatchBody["validationStatus"]; label: string }> = [
  { status: "matched_legacy", label: "Matched legacy" },
  { status: "mismatch", label: "Mismatch" },
  { status: "needs_mapping", label: "Needs mapping" },
  { status: "ignored_test", label: "Ignored (test)" },
];

type FormState = {
  legacyDeliveredClientAccountId: string;
  legacyDeliveredSubaccountIdGhl: string;
  legacyDeliveryContactIdGhl: string;
  legacyDeliveryStatus: string;
  validationNotes: string;
  validatedBy: string;
};

function formFromRow(row: RoutingDryRunDecisionItem): FormState {
  return {
    legacyDeliveredClientAccountId: row.legacyDeliveredClientAccountId ?? "",
    legacyDeliveredSubaccountIdGhl: row.legacyDeliveredSubaccountIdGhl ?? "",
    legacyDeliveryContactIdGhl: row.legacyDeliveryContactIdGhl ?? "",
    legacyDeliveryStatus: row.legacyDeliveryStatus ?? "",
    validationNotes: row.validationNotes ?? "",
    validatedBy: row.validatedBy ?? "",
  };
}

function toPatch(
  validationStatus: RoutingDryRunValidationPatchBody["validationStatus"],
  form: FormState
): RoutingDryRunValidationPatchBody {
  const trimOrNull = (v: string) => {
    const t = v.trim();
    return t ? t : null;
  };
  return {
    validationStatus,
    legacyDeliveredClientAccountId: trimOrNull(form.legacyDeliveredClientAccountId),
    legacyDeliveredSubaccountIdGhl: trimOrNull(form.legacyDeliveredSubaccountIdGhl),
    legacyDeliveryContactIdGhl: trimOrNull(form.legacyDeliveryContactIdGhl),
    legacyDeliveryStatus: trimOrNull(form.legacyDeliveryStatus),
    validationNotes: trimOrNull(form.validationNotes),
    validatedBy: form.validatedBy.trim() || undefined,
  };
}

export function RoutingDryRunValidationPanel({
  row,
  onUpdated,
}: {
  row: RoutingDryRunDecisionItem;
  onUpdated: (item: RoutingDryRunDecisionItem) => void;
}) {
  const [form, setForm] = useState(() => formFromRow(row));
  const [validationStatus, setValidationStatus] = useState(
    () => effectiveValidationStatus(row.validationStatus) as RoutingDryRunValidationPatchBody["validationStatus"]
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(formFromRow(row));
    setValidationStatus(
      effectiveValidationStatus(row.validationStatus) as RoutingDryRunValidationPatchBody["validationStatus"]
    );
  }, [row]);
  const [copyOk, setCopyOk] = useState(false);
  const [pending, startTransition] = useTransition();

  function patchField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function save(validationStatus: RoutingDryRunValidationPatchBody["validationStatus"]) {
    setError(null);
    startTransition(async () => {
      const res = await updateRoutingDryRunValidationAction(row.id, toPatch(validationStatus, form));
      if (!res.ok) {
        setError(formatRoutingDryRunActionError(res.error));
        return;
      }
      onUpdated(res.item);
      setForm(formFromRow(res.item));
    });
  }

  async function onCopySummary() {
    const summary = buildRoutingComparisonSummary({
      ...row,
      ...form,
      legacyDeliveredClientAccountId: form.legacyDeliveredClientAccountId.trim() || null,
      legacyDeliveredSubaccountIdGhl: form.legacyDeliveredSubaccountIdGhl.trim() || null,
      legacyDeliveryContactIdGhl: form.legacyDeliveryContactIdGhl.trim() || null,
      legacyDeliveryStatus: form.legacyDeliveryStatus.trim() || null,
      validationNotes: form.validationNotes.trim() || null,
    });
    const ok = await copyTextToClipboard(summary);
    setCopyOk(ok);
    window.setTimeout(() => setCopyOk(false), 2000);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="legacy-client">Legacy delivered client account ID</Label>
          <Input
            id="legacy-client"
            value={form.legacyDeliveredClientAccountId}
            onChange={(e) => patchField("legacyDeliveredClientAccountId", e.target.value)}
            autoComplete="off"
            className="font-mono text-xs"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="legacy-sub">Legacy delivered subaccount (GHL)</Label>
          <Input
            id="legacy-sub"
            value={form.legacyDeliveredSubaccountIdGhl}
            onChange={(e) => patchField("legacyDeliveredSubaccountIdGhl", e.target.value)}
            autoComplete="off"
            className="font-mono text-xs"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="legacy-contact">Legacy delivery contact (GHL)</Label>
          <Input
            id="legacy-contact"
            value={form.legacyDeliveryContactIdGhl}
            onChange={(e) => patchField("legacyDeliveryContactIdGhl", e.target.value)}
            autoComplete="off"
            className="font-mono text-xs"
          />
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="legacy-status">Legacy delivery status</Label>
          <Input
            id="legacy-status"
            value={form.legacyDeliveryStatus}
            onChange={(e) => patchField("legacyDeliveryStatus", e.target.value)}
            placeholder="e.g. delivered, failed, unknown"
            autoComplete="off"
            className="text-xs"
          />
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="validation-status">Validation status</Label>
          <select
            id="validation-status"
            className={selectClass}
            value={validationStatus}
            onChange={(e) =>
              setValidationStatus(
                e.target.value as RoutingDryRunValidationPatchBody["validationStatus"]
              )
            }
          >
            {FORM_VALIDATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="validation-notes">Validation notes</Label>
          <textarea
            id="validation-notes"
            className="min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={form.validationNotes}
            onChange={(e) => patchField("validationNotes", e.target.value)}
          />
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="validated-by">Validated by (optional)</Label>
          <Input
            id="validated-by"
            value={form.validatedBy}
            onChange={(e) => patchField("validatedBy", e.target.value)}
            placeholder="Operator initials"
            autoComplete="off"
            className="text-xs"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => save(validationStatus)}
        >
          Save review
        </Button>
        {QUICK_STATUSES.map((q) => (
          <Button
            key={q.status}
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setValidationStatus(q.status);
              save(q.status);
            }}
          >
            {q.label}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => save("legacy_unknown")}
        >
          Legacy unknown
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => save("unreviewed")}
        >
          Clear to unreviewed
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {row.suggestedLegacyPrefill.prefillReason ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              const p = row.suggestedLegacyPrefill;
              setForm((f) => ({
                ...f,
                legacyDeliveredClientAccountId:
                  f.legacyDeliveredClientAccountId.trim() ||
                  p.legacyDeliveredClientAccountId ||
                  "",
                legacyDeliveredSubaccountIdGhl:
                  f.legacyDeliveredSubaccountIdGhl.trim() ||
                  p.legacyDeliveredSubaccountIdGhl ||
                  "",
                legacyDeliveryContactIdGhl:
                  f.legacyDeliveryContactIdGhl.trim() || p.legacyDeliveryContactIdGhl || "",
                legacyDeliveryStatus:
                  f.legacyDeliveryStatus.trim() || p.legacyDeliveryStatus || "",
              }));
            }}
          >
            Use prefill hints
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="secondary" onClick={onCopySummary}>
          {copyOk ? "Copied" : "Copy comparison summary"}
        </Button>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
