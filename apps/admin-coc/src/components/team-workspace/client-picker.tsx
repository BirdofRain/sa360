"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { ClientOption } from "@/lib/team-workspace/types";

export function ClientPicker({
  clients,
  activeId,
}: {
  clients: ClientOption[];
  activeId?: string;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter((client) =>
      `${client.clientDisplayName} ${client.clientAccountId} ${client.status}`.toLowerCase().includes(needle)
    );
  }, [clients, query]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Clients">
      <label className="block text-sm font-medium text-slate-800" htmlFor="team-workspace-client-filter">
        Find a client
      </label>
      <input
        id="team-workspace-client-filter"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Name or id"
        className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3 text-sm text-slate-900"
      />
      {clients.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">No clients yet. Create one in guided setup.</p>
      ) : filtered.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">No client matches.</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {filtered.map((client) => {
            const active = client.clientAccountId === activeId;
            return (
              <li key={client.clientAccountId}>
                <Link
                  href={`/team-workspace/${client.clientAccountId}`}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "block rounded-md bg-slate-900 px-3 py-2 text-sm text-white"
                      : "block rounded-md px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
                  }
                >
                  <span className="block font-medium">{client.clientDisplayName}</span>
                  <span className={active ? "text-xs text-slate-200" : "text-xs text-slate-500"}>
                    {client.status}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
