"use client";

import { useMemo, useState, useTransition } from "react";

import { runDirectDemoDeliveryAction } from "@/app/actions/direct-delivery-demo";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DIRECT_DEMO_CLIENT_ACCOUNT_ID,
  DIRECT_DEMO_LIVE_CONFIRMATION_TEXT,
  DIRECT_DEMO_LOCATION_ID,
  type DirectDemoDeliveryResponse,
} from "@/lib/direct-delivery-demo/types";
import { directDemoLeadCreatedPayloadJson } from "@/lib/direct-delivery-demo/demo-payload";

function ResultCard({ result }: { result: DirectDemoDeliveryResponse }) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={result.ok ? "default" : "destructive"}>
          {result.ok ? "Success" : "Blocked"}
        </Badge>
        <Badge variant="outline">{result.mode}</Badge>
        {result.externalCallExecuted ? (
          <Badge variant="destructive">External GHL write executed</Badge>
        ) : (
          <Badge variant="secondary">No external writes</Badge>
        )}
      </div>
      {result.summary ? <p>{result.summary}</p> : null}
      {result.reason && !result.ok ? (
        <p className="text-destructive">{result.reason}</p>
      ) : null}
      <dl className="grid grid-cols-[160px_1fr] gap-x-2 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Matched</dt>
        <dd>{result.matched ? "Yes" : "No"}</dd>
        <dt className="text-muted-foreground">Destination client</dt>
        <dd className="font-mono break-all">{result.destinationClientAccountId ?? "—"}</dd>
        <dt className="text-muted-foreground">Destination location</dt>
        <dd className="font-mono break-all">{result.destinationSubaccountIdGhl ?? "—"}</dd>
        <dt className="text-muted-foreground">Routing decision</dt>
        <dd className="font-mono break-all">{result.routingDryRunDecisionId ?? "—"}</dd>
        <dt className="text-muted-foreground">Delivery plan</dt>
        <dd className="font-mono break-all">{result.deliveryPlanId ?? "—"}</dd>
        <dt className="text-muted-foreground">Adapter run</dt>
        <dd className="font-mono break-all">{result.adapterRunId ?? "—"}</dd>
        <dt className="text-muted-foreground">Live run</dt>
        <dd className="font-mono break-all">{result.liveRunId ?? "—"}</dd>
        <dt className="text-muted-foreground">Plan status</dt>
        <dd>{result.deliveryPlanStatus ?? "—"}</dd>
        <dt className="text-muted-foreground">Adapter mode</dt>
        <dd className="font-mono">{result.adapterMode ?? "—"}</dd>
      </dl>
      {result.duplicateRisk ? (
        <div className="rounded-md border border-border bg-background p-2 text-xs">
          <p className="font-medium">Duplicate risk</p>
          <p>
            {result.duplicateRisk.riskLevel}
            {result.duplicateRisk.blocksLiveDelivery ? " — blocks live" : ""}
          </p>
          {result.duplicateRisk.recommendedAction ? (
            <p className="text-muted-foreground">{result.duplicateRisk.recommendedAction}</p>
          ) : null}
        </div>
      ) : null}
      {result.readiness ? (
        <div className="rounded-md border border-border bg-background p-2 text-xs">
          <p className="font-medium">Delivery readiness</p>
          <p>{result.readiness.canDeliverLive ? "Can deliver live" : "Not live-ready"}</p>
          {result.readiness.blockers.length ? (
            <ul className="mt-1 list-disc pl-4 text-muted-foreground">
              {result.readiness.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {result.blockers?.length ? (
        <div>
          <p className="text-xs font-medium text-destructive">Blockers</p>
          <ul className="list-disc pl-4 text-xs text-destructive">
            {result.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.warnings?.length ? (
        <div>
          <p className="text-xs font-medium text-amber-700">Warnings</p>
          <ul className="list-disc pl-4 text-xs text-amber-800">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.nextAction ? (
        <p className="text-xs text-muted-foreground">Next: {result.nextAction}</p>
      ) : null}
    </div>
  );
}

export function DirectDeliveryDemoPanel() {
  const [raw, setRaw] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DirectDemoDeliveryResponse | null>(null);
  const [pending, startTransition] = useTransition();

  const liveEnabled = useMemo(
    () => confirmation.trim() === DIRECT_DEMO_LIVE_CONFIRMATION_TEXT,
    [confirmation]
  );

  function run(mode: "simulate" | "live_canary") {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await runDirectDemoDeliveryAction(raw, mode, confirmation);
      if (!res.ok) {
        setError(res.error);
        if (res.data) setResult(res.data);
        return;
      }
      setResult(res.data);
    });
  }

  return (
    <div className="space-y-4">
      <WarningBanner tone="warn" title="Demo only — guarded direct delivery">
        Routes one normalized <span className="font-mono">lead_created</span> through dry-run → plan →
        adapter simulation. Live canary can create/update one contact in Smart Agent 360 Demo (
        <span className="font-mono">{DIRECT_DEMO_CLIENT_ACCOUNT_ID}</span> /{" "}
        <span className="font-mono">{DIRECT_DEMO_LOCATION_ID}</span>) when every safety gate passes.
      </WarningBanner>

      <div className="space-y-2">
        <Label htmlFor="direct-demo-payload">Normalized lifecycle JSON</Label>
        <textarea
          id="direct-demo-payload"
          className="min-h-[220px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
          placeholder='{"client_account_id":"lal_master_vet", ...}'
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              setError(null);
              setRaw(directDemoLeadCreatedPayloadJson());
            }}
          >
            Load demo payload
          </Button>
          <Button type="button" disabled={pending || !raw.trim()} onClick={() => run("simulate")}>
            {pending ? "Running…" : "Run simulation"}
          </Button>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <p className="text-sm font-medium text-destructive">Live canary (one lead)</p>
        <p className="text-xs text-muted-foreground">
          Requires <span className="font-mono">GHL_DELIVERY_ADAPTER_MODE=live_canary</span>, direct
          delivery env allowlist, OAuth connection, readiness, and successful simulation.
        </p>
        <div className="grid gap-2 sm:max-w-md">
          <Label htmlFor="direct-demo-confirm">Type {DIRECT_DEMO_LIVE_CONFIRMATION_TEXT}</Label>
          <Input
            id="direct-demo-confirm"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="off"
            disabled={pending}
          />
        </div>
        <Button
          type="button"
          variant="destructive"
          disabled={pending || !raw.trim() || !liveEnabled}
          onClick={() => run("live_canary")}
        >
          Run live canary delivery
        </Button>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {result ? <ResultCard result={result} /> : null}
    </div>
  );
}
