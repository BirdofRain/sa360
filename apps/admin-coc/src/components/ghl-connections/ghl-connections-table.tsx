"use client";

import { useState, useTransition } from "react";

import {
  dismissGhlOAuthPendingInstallAction,
  disconnectGhlConnectionAction,
  linkGhlConnectionClientAction,
  probeGhlConnectionAction,
  purgeGhlConnectionAction,
  startGhlOAuthConnectAction,
} from "@/app/actions/ghl-connections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import type {
  GhlLocationConnectionItem,
  GhlOAuthPendingInstallItem,
} from "@/lib/ghl-connections/types";
import {
  ghlConnectionStatusBadgeClass,
  ghlConnectionStatusLabel,
  isGhlDeliverableConnection,
  validateLinkClientAccountId,
} from "@/lib/ghl-connections/ghl-connection-display";
import { cn } from "@/lib/utils";

const TEST_LOCATION_PREFIXES = ["loc_unlinked", "loc_inject", "loc_storage_fail"];

function isTestLocationId(locationId: string): boolean {
  return TEST_LOCATION_PREFIXES.some((p) => locationId.startsWith(p));
}

export function GhlConnectionsTable({
  initialItems,
  initialPending,
  oauthNotice,
}: {
  initialItems: GhlLocationConnectionItem[];
  initialPending: GhlOAuthPendingInstallItem[];
  oauthNotice?: string | null;
}) {
  const [items, setItems] = useState(initialItems);
  const [pendingInstalls, setPendingInstalls] = useState(initialPending);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [linkDraft, setLinkDraft] = useState<Record<string, string>>({});

  function connectGhl() {
    setError(null);
    startTransition(async () => {
      const res = await startGhlOAuthConnectAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      window.location.href = res.authorizeUrl;
    });
  }

  function probe(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await probeGhlConnectionAction(id);
      if (res.connection) {
        setItems((prev) => prev.map((row) => (row.id === id ? res.connection! : row)));
      }
      if (!res.ok) setError(res.error ?? res.detail ?? "Probe failed.");
    });
  }

  function linkClient(id: string) {
    const clientAccountId = linkDraft[id] ?? "";
    const validation = validateLinkClientAccountId(clientAccountId);
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await linkGhlConnectionClientAction(id, clientAccountId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setItems((prev) => prev.map((row) => (row.id === id ? res.connection : row)));
    });
  }

  function disconnect(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await disconnectGhlConnectionAction(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.ok) {
        setItems((prev) => prev.map((row) => (row.id === id ? res.connection : row)));
      }
    });
  }

  function purgeConnection(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await purgeGhlConnectionAction(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setItems((prev) => prev.filter((row) => row.id !== id));
    });
  }

  function dismissPending(id: string, purge: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await dismissGhlOAuthPendingInstallAction(id, purge);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPendingInstalls((prev) => prev.filter((row) => row.id !== id));
    });
  }

  return (
    <div className="space-y-4">
      <WarningBanner tone="info" title="OAuth connections only">
        Tokens are stored encrypted server-side. This UI never displays access or refresh tokens.
        Only locations with status <strong>connected</strong> are delivery-capable.
      </WarningBanner>

      {oauthNotice ? (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">{oauthNotice}</p>
      ) : null}

      <Button type="button" onClick={connectGhl} disabled={isPending}>
        {isPending ? "Starting…" : "Connect GHL subaccount"}
      </Button>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {pendingInstalls.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Pending OAuth installs (non-delivery)</h2>
          <div className="overflow-x-auto rounded-lg border border-sky-500/30">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-sky-500/5 text-left text-xs">
                  <th className="px-3 py-2">Company / user</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingInstalls.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 align-top">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs">company: {row.companyId ?? "—"}</div>
                      <div className="font-mono text-xs text-muted-foreground">user: {row.userId ?? "—"}</div>
                      {row.lastError ? (
                        <div className="mt-1 text-xs text-amber-800 dark:text-amber-200">{row.lastError}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs">{row.userType ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Badge
                        variant="outline"
                        className={cn("w-fit", ghlConnectionStatusBadgeClass(row.status))}
                      >
                        {ghlConnectionStatusLabel(row.status)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() => dismissPending(row.id, false)}
                        >
                          Revoke
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={isPending}
                          onClick={() => dismissPending(row.id, true)}
                        >
                          Remove
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Location connections</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs">
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Auth</th>
                <th className="px-3 py-2">Last probe</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    No location connections yet. Complete OAuth or wait for INSTALL webhook reconciliation.
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.locationName ?? "—"}</div>
                      <div className="font-mono text-xs text-muted-foreground">{row.locationId}</div>
                      {!isGhlDeliverableConnection(row.connectionStatus) ? (
                        <div className="mt-1 text-xs text-sky-800 dark:text-sky-200">
                          Not delivery-capable until connected with a valid location token.
                        </div>
                      ) : null}
                      {row.lastError ? (
                        <div className="mt-1 text-xs text-amber-800 dark:text-amber-200">{row.lastError}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{row.clientAccountId ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Badge
                        variant="outline"
                        className={cn("w-fit", ghlConnectionStatusBadgeClass(row.connectionStatus))}
                      >
                        {ghlConnectionStatusLabel(row.connectionStatus)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs">{row.authMode}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {row.lastProbeAt ? new Date(row.lastProbeAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 space-y-2">
                      <div className="flex flex-wrap gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={isPending || !isGhlDeliverableConnection(row.connectionStatus)}
                          onClick={() => probe(row.id)}
                        >
                          Probe
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() => disconnect(row.id)}
                        >
                          Disconnect
                        </Button>
                        {isTestLocationId(row.locationId) ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={isPending}
                            onClick={() => purgeConnection(row.id)}
                          >
                            Remove test
                          </Button>
                        ) : null}
                      </div>
                      <div className="flex gap-1">
                        <input
                          className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
                          placeholder="clientAccountId"
                          value={linkDraft[row.id] ?? row.clientAccountId ?? ""}
                          onChange={(e) => setLinkDraft((d) => ({ ...d, [row.id]: e.target.value }))}
                        />
                        <Button type="button" size="sm" disabled={isPending} onClick={() => linkClient(row.id)}>
                          Link
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
