"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { BulkImportDestinationOption } from "@/app/actions/bulk-imports";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  options: BulkImportDestinationOption[];
  initialClientId?: string;
  initialLocationId?: string;
  loading?: boolean;
  onSave: (payload: {
    destinationClientAccountId: string;
    destinationLocationIdGhl: string;
    workflowStrategy: "source_tag_only";
    workflowWarningAcknowledged: boolean;
  }) => void;
};

export function BulkImportDestinationSelector({
  options,
  initialClientId,
  initialLocationId,
  loading,
  onSave,
}: Props) {
  const [clientSearch, setClientSearch] = useState("");
  const [clientId, setClientId] = useState(initialClientId ?? "");
  const [locationId, setLocationId] = useState(initialLocationId ?? "");
  const [manualClientId, setManualClientId] = useState("");
  const [manualLocationId, setManualLocationId] = useState("");

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
    if (!clientId && initialClientId) setClientId(initialClientId);
    if (!locationId && initialLocationId) setLocationId(initialLocationId);
  }, [initialClientId, initialLocationId, clientId, locationId]);

  useEffect(() => {
    if (locationOptions.length === 1 && !locationId) {
      setLocationId(locationOptions[0]!.locationIdGhl);
    }
  }, [locationOptions, locationId]);

  const canSave =
    Boolean(clientId && locationId && selectedOption?.readyForSimulation) && !loading;

  return (
    <div className="grid max-w-2xl gap-4">
      <div className="space-y-2">
        <Label htmlFor="client-search">Search client</Label>
        <Input
          id="client-search"
          placeholder="Search by name or ID"
          value={clientSearch}
          onChange={(e) => setClientSearch(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="client-select">Client</Label>
        <select
          id="client-select"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setLocationId("");
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
          onChange={(e) => setLocationId(e.target.value)}
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
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <p>
            Readiness: <strong>{selectedOption.readinessStatus}</strong> · OAuth:{" "}
            {selectedOption.oauthStatus}
          </p>
          {selectedOption.blockers.length ? (
            <ul className="mt-2 list-disc pl-5 text-amber-800">
              {selectedOption.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-muted-foreground">No blockers reported.</p>
          )}
          {clientId ? (
            <Link
              href={`/clients/${encodeURIComponent(clientId)}/delivery-config`}
              className="mt-2 inline-block text-sm underline"
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
              setClientId(manualClientId.trim());
              setLocationId(manualLocationId.trim());
            }}
          >
            Use manual IDs
          </Button>
        </div>
      </details>

      <Button
        disabled={!canSave}
        onClick={() =>
          onSave({
            destinationClientAccountId: clientId,
            destinationLocationIdGhl: locationId,
            workflowStrategy: "source_tag_only",
            workflowWarningAcknowledged: true,
          })
        }
      >
        {loading ? "Saving destination…" : "Save destination"}
      </Button>
    </div>
  );
}
