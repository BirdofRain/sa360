"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { probeGhlConnectionAction } from "@/app/actions/ghl-connections";
import { GhlConfigDiscoveryPanel } from "@/components/dashboard/ghl-config-discovery-panel";
import { SourceFieldMappingSection } from "@/components/clients/source-field-mapping-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ClientDeliveryConfigSummary } from "@/lib/clients/delivery-config-types";
import {
  ghlConnectionStatusBadgeClass,
  ghlConnectionStatusLabel,
} from "@/lib/ghl-connections/ghl-connection-display";
import {
  readinessStatusBadgeClass,
  readinessStatusLabel,
} from "@/lib/delivery-readiness/delivery-readiness-display";
import { cn } from "@/lib/utils";

function RecoveryBanner({ summary }: { summary: ClientDeliveryConfigSummary }) {
  if (summary.issueCodes.includes("oauth_revoked")) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        OAuth connection is revoked.{" "}
        <Link href="/ghl-connections" className="font-medium underline">
          Reconnect the GHL location
        </Link>
        .
      </p>
    );
  }
  if (summary.issueCodes.includes("location_unlinked") || !summary.locationId) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        This GHL location is not linked to this client.{" "}
        <Link href="/ghl-connections" className="font-medium underline">
          Connect or link GHL location
        </Link>
        .
      </p>
    );
  }
  if (summary.issueCodes.includes("probe_required")) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Run a probe before discovering configuration.
      </p>
    );
  }
  if (summary.locationMismatch) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        The requested location does not match the saved client destination record.
      </p>
    );
  }
  return null;
}

export function ClientDeliveryConfigPanel({
  initialSummary,
}: {
  initialSummary: ClientDeliveryConfigSummary;
}) {
  const router = useRouter();
  const [summary, setSummary] = useState(initialSummary);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const conn = summary.connection;
  const readiness = summary.destinationReadiness;

  function probeConnection() {
    if (!conn?.id) return;
    setError(null);
    startTransition(async () => {
      const res = await probeGhlConnectionAction(conn.id);
      if (!res.ok || !res.connection) {
        setError(res.error ?? "Probe failed.");
        return;
      }
      setSummary((prev) => ({
        ...prev,
        connection: res.connection ?? prev.connection,
      }));
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <RecoveryBanner summary={summary} />

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
        <h2 className="text-sm font-semibold text-slate-900">Client and location identity</h2>
        <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Client</dt>
            <dd className="font-medium">{summary.clientDisplayName}</dd>
            <dd className="font-mono text-xs text-muted-foreground">{summary.clientAccountId}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">GHL location</dt>
            <dd className="font-medium">{summary.locationName ?? "—"}</dd>
            <dd className="font-mono text-xs text-muted-foreground">{summary.locationId ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">OAuth status</dt>
            <dd>
              {conn ? (
                <Badge
                  variant="outline"
                  className={cn("w-fit", ghlConnectionStatusBadgeClass(conn.connectionStatus))}
                >
                  {ghlConnectionStatusLabel(conn.connectionStatus)}
                </Badge>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Last probe</dt>
            <dd className="text-xs">
              {conn?.lastProbeAt ? new Date(conn.lastProbeAt).toLocaleString() : "—"}
            </dd>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          {conn ? (
            <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={probeConnection}>
              Probe location
            </Button>
          ) : null}
          <Link
            href="/ghl-connections"
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-xs font-medium"
          >
            View GHL connection
          </Link>
          <Link
            href={`/clients/${encodeURIComponent(summary.clientAccountId)}`}
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-xs font-medium"
          >
            Back to client profile
          </Link>
        </div>
        {conn?.lastError ? (
          <p className="mt-2 text-xs text-amber-800">{conn.lastError}</p>
        ) : null}
      </section>

      {summary.locationId ? (
        <>
          <GhlConfigDiscoveryPanel
            mode="destination"
            clientAccountId={summary.clientAccountId}
            locationId={summary.locationId}
            locationName={summary.locationName}
            destination={summary.ghlDestination}
            destinationReadiness={readiness}
            onSaved={({ ghlDestination, destinationReadiness }) => {
              setSummary((prev) => ({
                ...prev,
                ghlDestination,
                destinationReadiness,
              }));
              router.refresh();
            }}
          />
          <SourceFieldMappingSection
            clientAccountId={summary.clientAccountId}
            locationId={summary.locationId}
            ghlDestination={summary.ghlDestination}
            discoveredCustomFields={[]}
            onSaved={(ghlDestination) => {
              setSummary((prev) => ({ ...prev, ghlDestination }));
              router.refresh();
            }}
          />
        </>
      ) : null}

      {readiness ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Destination readiness</h2>
            <Badge
              variant="outline"
              className={cn("w-fit", readinessStatusBadgeClass(readiness.readinessStatus))}
            >
              {readinessStatusLabel(readiness.readinessStatus)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{readiness.recommendedNextAction}</p>
          <ul className="mt-3 space-y-1 text-sm">
            {readiness.checklist.map((item) => (
              <li key={item.key} className="flex items-start gap-2">
                <span className={item.complete ? "text-emerald-700" : "text-amber-800"}>
                  {item.complete ? "✓" : "○"}
                </span>
                <span>
                  {item.label}
                  {item.detail ? (
                    <span className="ml-1 text-xs text-muted-foreground">({item.detail})</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {readiness.blockers.length > 0 ? (
            <ul className="mt-3 list-inside list-disc text-xs text-amber-900">
              {readiness.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
