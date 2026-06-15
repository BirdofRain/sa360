"use client";

import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClientAccountListItem } from "@/lib/clients/types";

export function ClientAccountSelector({
  clients,
  value,
  onChange,
  disabled,
  id = "clientAccountSelector",
}: {
  clients: ClientAccountListItem[];
  value: string;
  onChange: (clientAccountId: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients.slice(0, 50);
    return clients
      .filter(
        (c) =>
          c.clientAccountId.toLowerCase().includes(q) ||
          c.clientDisplayName.toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [clients, query]);

  const selected = clients.find((c) => c.clientAccountId === value);

  return (
    <div className="space-y-2">
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-search`}>Search client</Label>
        <Input
          id={`${id}-search`}
          placeholder="Display name or clientAccountId"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
          className="text-xs"
        />
      </div>
      <select
        id={id}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">— Select client —</option>
        {filtered.map((c) => (
          <option key={c.clientAccountId} value={c.clientAccountId}>
            {c.clientDisplayName} ({c.clientAccountId})
          </option>
        ))}
      </select>
      {selected ? (
        <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs">
          <div className="font-medium">{selected.clientDisplayName}</div>
          <div className="font-mono text-muted-foreground">{selected.clientAccountId}</div>
        </div>
      ) : null}
    </div>
  );
}
