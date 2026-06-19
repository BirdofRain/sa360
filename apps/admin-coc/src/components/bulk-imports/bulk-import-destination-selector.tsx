"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { BulkImportDestinationOption } from "@/app/actions/bulk-imports";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type DestinationDraft = {
  clientId: string;
  locationId: string;
};

export type DestinationSaveDiagnostic = {
  attemptedClientAccountId: string;
  attemptedLocationIdGhl: string;
  ok: boolean;
  error?: string;
  nextStep?: string;
  batchStatus?: string;
  timestamp: string;
};

type Props = {
  options: BulkImportDestinationOption[];
  draft: DestinationDraft;
  isDirty: boolean;
  onDraftChange: (draft: DestinationDraft, dirty: boolean) => void;
  lastSaveDiagnostic?: DestinationSaveDiagnostic | null;
};

export function BulkImportDestinationSelector({
  options,
  draft,
  isDirty: _isDirty,
  onDraftChange,
  lastSaveDiagnostic,
}: Props) {
  const [clientSearch, setClientSearch] = useState("");
  const [manualClientId, setManualClientId] = useState("");
  const [manualLocationId, setManualLocationId] = useState("");

  const clientId = draft.clientId;
  const locationId = draft.locationId;

  const clients = useMemo(() => {
    const byClient = new Map<string, BulkImportDestinationOption[]>();
    for (const opt of options) {
      const list = byClient.get(opt.clientAccountId) ?? [];
      list.push(opt);
      byClient.set(opt.clientAccountId, list);
    }
    return [...byClient.entries()].map(([id, locs]) => ({
      clientAccountId: id,
      clientDisplayName: locs[0]!.clientDisplayName,
      locations: locs,
    }));
  }, [options]);

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.clientDisplayName.toLowerCase().includes(q) ||
        c.clientAccountId.toLowerCase().includes(q)
    );
  }, [clientSearch, clients]);

  const selectedClient = clients.find((c) => c.clientAccountId === clientId);
  const locationOptions = selectedClient?.locations ?? [];
  const selectedOption = options.find(
    (o) => o.clientAccountId === clientId && o.locationIdGhl === locationId
  );

  useEffect(() => {
    if (locationOptions.length === 1 && !locationId) {
      onDraftChange(
        { clientId, locationId: locationOptions[0]!.locationIdGhl },
        true
      );
    }
  }, [locationOptions, locationId, clientId, onDraftChange]);

  return (
    <div className="grid max-w-2xl gap-4">
      <div className="space-y-2">
        <Label htmlFor="client-search">Search client</Label>
        <Input
          id="client-search"
          value={clientSearch}
          onChange={(e) => setClientSearch(e.target.value)}
          placeholder="Search by name or ID"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="client-select">Client</Label>
        <select
          id="client-select"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={clientId}
          onChange={(e) => {
            onDraftChange({ clientId: e.target.value, locationId: "" }, true);
          }}
        >
          <option value="">Select a client…</option>
          {filteredClients.map((client) => (
            <option key={client.clientAccountId} value={client.clientAccountId}>
              {client.clientDisplayName} ({client.clientAccountId})
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="location-select">GHL location</Label>
        <select
          id="location-select"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={locationId}
          disabled={!clientId}
          onChange={(e) => {
            onDraftChange({ clientId, locationId: e.target.value }, true);
          }}
        >
          <option value="">Select a location…</option>
          {locationOptions.map((loc) => (
            <option
              key={loc.locationIdGhl}
              value={loc.locationIdGhl}
              disabled={!loc.readyForSimulation}
            >
              {loc.locationName} ({loc.locationIdGhl})
              {loc.readyForSimulation ? "" : " — not ready"}
            </option>
          ))}
        </select>
      </div>

      {selectedOption ? (
        <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-2">
          <p>
            Readiness: <strong>{selectedOption.readinessStatus}</strong> · OAuth:{" "}
            {selectedOption.oauthStatus}
          </p>
          {selectedOption.readyForSimulation && !selectedOption.isInitialCanaryTarget ? (
            <p className="text-amber-800">
              This destination is ready for simulation, but it is not the configured initial
              live-canary client. Live approval will be blocked.
            </p>
          ) : selectedOption.isInitialCanaryTarget ? (
            <p className="text-green-800">
              Configured initial live-canary destination for this environment.
            </p>
          ) : null}
          {selectedOption.blockers?.length ? (
            <ul className="list-disc pl-5 text-amber-800">
              {(selectedOption.blockers ?? []).map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No blockers reported.</p>
          )}
          {clientId ? (
            <Link
              href={`/clients/${encodeURIComponent(clientId)}/delivery-config`}
              className="inline-block text-sm underline"
            >
              Open client delivery configuration
            </Link>
          ) : null}
        </div>
      ) : null}

      <details>
        <summary className="cursor-pointer text-xs text-amber-800">
          Advanced manual entry (admin-only, unsafe)
        </summary>
        <div className="mt-2 grid gap-2">
          <Input
            placeholder="Client account ID"
            value={manualClientId}
            onChange={(e) => setManualClientId(e.target.value)}
          />
          <Input
            placeholder="GHL location ID"
            value={manualLocationId}
            onChange={(e) => setManualLocationId(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              onDraftChange(
                {
                  clientId: manualClientId.trim(),
                  locationId: manualLocationId.trim(),
                },
                true
              );
            }}
          >
            Use manual IDs
          </Button>
        </div>
      </details>

      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Advanced — last destination save
        </summary>
        <div className="mt-2 rounded border bg-muted/20 p-3 text-xs font-mono space-y-1">
          {lastSaveDiagnostic ? (
            <>
              <p>attemptedClientAccountId: {lastSaveDiagnostic.attemptedClientAccountId || "—"}</p>
              <p>attemptedLocationIdGhl: {lastSaveDiagnostic.attemptedLocationIdGhl || "—"}</p>
              <p>result: {lastSaveDiagnostic.ok ? "ok" : "failed"}</p>
              {lastSaveDiagnostic.error ? <p>error: {lastSaveDiagnostic.error}</p> : null}
              <p>nextStep: {lastSaveDiagnostic.nextStep ?? "—"}</p>
              <p>batchStatus: {lastSaveDiagnostic.batchStatus ?? "—"}</p>
              <p>timestamp: {lastSaveDiagnostic.timestamp}</p>
            </>
          ) : (
            <p>No destination save attempted in this session.</p>
          )}
        </div>
      </details>
    </div>
  );
}
