"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  patchClientGhlDestinationAction,
} from "@/app/actions/clients";
import {
  startGhlOAuthConnectAction,
} from "@/app/actions/ghl-connections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildClientDeliveryConfigHref } from "@/lib/clients/delivery-config-query";
import type { ClientAccountDetail } from "@/lib/clients/types";
import {
  readinessStatusBadgeClass,
  readinessStatusLabel,
} from "@/lib/delivery-readiness/delivery-readiness-display";
import { cn } from "@/lib/utils";

export function ClientGhlDestinationSection({
  client,
  pending,
  onUpdated,
}: {
  client: ClientAccountDetail;
  pending: boolean;
  onUpdated: (item: ClientAccountDetail) => void;
}) {
  const router = useRouter();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthPending, startOauth] = useTransition();
  const [savePending, startSave] = useTransition();

  const dest = client.ghlDestination;
  const readiness = client.destinationReadiness;
  const locationId = dest?.destinationSubaccountIdGhl ?? null;

  function connectOAuth() {
    setError(null);
    startOauth(async () => {
      const returnTo = buildClientDeliveryConfigHref({
        clientAccountId: client.clientAccountId,
        locationId: locationId ?? undefined,
      });
      const res = await startGhlOAuthConnectAction(client.clientAccountId, returnTo);
      if (!res.ok || !res.authorizeUrl) {
        setError(res.error ?? "Could not start OAuth.");
        return;
      }
      window.location.href = res.authorizeUrl;
    });
  }

  function saveAdvanced(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      destinationSubaccountIdGhl: String(fd.get("destinationSubaccountIdGhl") ?? ""),
      locationName: String(fd.get("locationName") ?? "") || null,
      ghlConnectionStatus: String(fd.get("ghlConnectionStatus") ?? "") || null,
    };
    startSave(async () => {
      const result = await patchClientGhlDestinationAction(client.clientAccountId, body);
      if (!result.ok) setError(result.error);
      else {
        setError(null);
        onUpdated(result.item);
        router.refresh();
      }
    });
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <h3 className="text-sm font-semibold text-slate-900">GHL destination</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Destination configuration is source-agnostic. Configure pipeline, fields, and workflow before
        creating routing rules.
      </p>

      {!locationId ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-muted-foreground">Connect or link a GHL location to this client.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={pending || oauthPending} onClick={connectOAuth}>
              Connect GHL location
            </Button>
            <Link
              href="/ghl-connections"
              className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-xs font-medium"
            >
              View GHL connections
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <dl className="grid gap-2 text-sm md:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Location name</dt>
              <dd>{dest?.locationName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Location ID</dt>
              <dd className="font-mono text-xs">{locationId}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">OAuth status</dt>
              <dd>{dest?.ghlConnectionStatus ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Destination readiness</dt>
              <dd>
                {readiness ? (
                  <Badge
                    variant="outline"
                    className={cn("w-fit", readinessStatusBadgeClass(readiness.readinessStatus))}
                  >
                    {readinessStatusLabel(readiness.readinessStatus)}
                  </Badge>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Link
              href={buildClientDeliveryConfigHref({
                clientAccountId: client.clientAccountId,
                locationId,
              })}
              className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
            >
              Configure delivery
            </Link>
            <Link
              href="/ghl-connections"
              className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-xs font-medium"
            >
              View GHL connection
            </Link>
            <Button type="button" size="sm" variant="outline" disabled={pending || oauthPending} onClick={connectOAuth}>
              Reconnect OAuth
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4">
        <button
          type="button"
          className="text-xs font-medium text-sky-700 hover:underline"
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen ? "Hide advanced manual entry" : "Advanced manual entry"}
        </button>
        {advancedOpen ? (
          <form onSubmit={saveAdvanced} className="mt-2 grid gap-2 md:grid-cols-2">
            <div className="grid gap-1.5 md:col-span-2">
              <Label htmlFor="destinationSubaccountIdGhl">GHL location ID</Label>
              <Input
                id="destinationSubaccountIdGhl"
                name="destinationSubaccountIdGhl"
                defaultValue={dest?.destinationSubaccountIdGhl ?? ""}
                disabled={pending || savePending}
                className="font-mono text-xs"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="locationName">Location name</Label>
              <Input
                id="locationName"
                name="locationName"
                defaultValue={dest?.locationName ?? ""}
                disabled={pending || savePending}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ghlConnectionStatus">Connection status</Label>
              <Input
                id="ghlConnectionStatus"
                name="ghlConnectionStatus"
                placeholder="connected"
                defaultValue={dest?.ghlConnectionStatus ?? ""}
                disabled={pending || savePending}
              />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" size="sm" disabled={pending || savePending}>
                Save manual destination IDs
              </Button>
            </div>
          </form>
        ) : null}
      </div>

      {error ? (
        <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
