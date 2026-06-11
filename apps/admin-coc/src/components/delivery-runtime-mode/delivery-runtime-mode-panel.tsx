"use client";

import { useEffect, useState, useTransition } from "react";

import {
  loadDeliveryRuntimeModeAction,
  setDeliveryRuntimeModeAction,
} from "@/app/actions/delivery-runtime-mode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ENABLE_LIVE_CANARY_CONFIRMATION_TEXT,
  RETURN_TO_SIMULATE_CONFIRMATION_TEXT,
  type DeliveryRuntimeModeStatus,
} from "@/lib/delivery-runtime-mode/types";

function formatExpiry(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function DeliveryRuntimeModePanel() {
  const [status, setStatus] = useState<DeliveryRuntimeModeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enableText, setEnableText] = useState("");
  const [returnText, setReturnText] = useState("");
  const [reason, setReason] = useState("");
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => {
      setError(null);
      const res = await loadDeliveryRuntimeModeAction();
      if (!res.ok) {
        setError(res.error ?? "Could not load runtime mode.");
        return;
      }
      setStatus(res.status);
    });
  }

  useEffect(() => {
    refresh();
  }, []);

  const enableReady = enableText.trim() === ENABLE_LIVE_CANARY_CONFIRMATION_TEXT;
  const returnReady = returnText.trim() === RETURN_TO_SIMULATE_CONFIRMATION_TEXT;

  function enableLiveCanary() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await setDeliveryRuntimeModeAction({
        mode: "live_canary",
        durationMinutes: 15,
        operatorConfirmationText: enableText.trim(),
        reason: reason.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not enable live canary.");
        return;
      }
      setStatus(res.status);
      setSuccess("Live canary enabled for 15 minutes.");
      setEnableText("");
    });
  }

  function returnToSimulate() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await setDeliveryRuntimeModeAction({
        mode: "simulate",
        operatorConfirmationText: returnText.trim(),
      });
      if (!res.ok) {
        setError(res.error ?? "Could not return to simulate.");
        return;
      }
      setStatus(res.status);
      setSuccess("Returned to simulate.");
      setReturnText("");
    });
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div>
        <h3 className="text-sm font-semibold">Delivery runtime mode</h3>
        <p className="text-xs text-muted-foreground">
          Env sets the maximum capability (kill switch). This toggle sets the current effective mode
          without redeploying. It does not deliver leads by itself — guarded live canary still
          requires all safety gates and{" "}
          <span className="font-mono">DELIVER ONE LEAD</span> per run.
        </p>
      </div>

      {status ? (
        <dl className="grid grid-cols-[140px_1fr] gap-x-2 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Effective mode</dt>
          <dd className="font-medium">{status.effectiveMode}</dd>
          <dt className="text-muted-foreground">Max allowed (env)</dt>
          <dd className="font-mono">{status.maxAllowedMode}</dd>
          <dt className="text-muted-foreground">Configured runtime</dt>
          <dd>{status.configuredRuntimeMode}</dd>
          <dt className="text-muted-foreground">Live canary until</dt>
          <dd>{formatExpiry(status.liveCanaryEnabledUntil)}</dd>
          <dt className="text-muted-foreground">Can run live canary</dt>
          <dd>{status.canRunLiveCanary ? "Yes" : "No"}</dd>
          <dt className="text-muted-foreground">Last changed by</dt>
          <dd>{status.enabledBy ?? "—"}</dd>
          <dt className="text-muted-foreground">Last reason</dt>
          <dd>{status.reason}</dd>
        </dl>
      ) : (
        <p className="text-xs text-muted-foreground">{pending ? "Loading…" : "No status loaded."}</p>
      )}

      <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
        <p className="font-medium text-amber-900 dark:text-amber-100">Enable live canary (15 min)</p>
        <Label htmlFor="runtime-enable-reason">Reason</Label>
        <Input
          id="runtime-enable-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Direct Delivery Demo test"
          className="text-sm"
        />
        <Label htmlFor="runtime-enable-confirm">
          Type <span className="font-mono">{ENABLE_LIVE_CANARY_CONFIRMATION_TEXT}</span>
        </Label>
        <Input
          id="runtime-enable-confirm"
          value={enableText}
          onChange={(e) => setEnableText(e.target.value)}
          className="font-mono text-sm"
        />
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={pending || !enableReady || !reason.trim()}
          onClick={enableLiveCanary}
        >
          Enable live canary for 15 minutes
        </Button>
      </div>

      <div className="space-y-2 rounded-md border border-border p-2 text-xs">
        <p className="font-medium">Return to simulate now</p>
        <Label htmlFor="runtime-return-confirm">
          Type <span className="font-mono">{RETURN_TO_SIMULATE_CONFIRMATION_TEXT}</span> or use button
          after filling
        </Label>
        <Input
          id="runtime-return-confirm"
          value={returnText}
          onChange={(e) => setReturnText(e.target.value)}
          className="font-mono text-sm"
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending || !returnReady}
          onClick={returnToSimulate}
        >
          Return to simulate now
        </Button>
      </div>

      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={refresh}>
        Refresh status
      </Button>

      {success ? <p className="text-xs text-emerald-700 dark:text-emerald-300">{success}</p> : null}
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
