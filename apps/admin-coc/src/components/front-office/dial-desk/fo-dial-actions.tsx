"use client";

import { Phone, MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DISPOSITION_LABELS } from "@/lib/front-office/display";
import type { DialDisposition } from "@/lib/front-office/types";

const DISPOSITIONS: DialDisposition[] = [
  "contacted",
  "set_appointment",
  "follow_up",
  "bad_number",
  "dnc",
  "no_show",
  "sold",
];

export function FoDialActions({
  onDisposition,
  lastLogged,
}: {
  onDisposition: (d: DialDisposition) => void;
  lastLogged?: string | null;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="default" disabled title="Mock only — no live dial">
          <Phone className="size-4" aria-hidden />
          Call
        </Button>
        <Button type="button" variant="outline" disabled title="Mock only — no live SMS">
          <MessageSquare className="size-4" aria-hidden />
          Text
        </Button>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Disposition
        </p>
        <div className="flex flex-wrap gap-2">
          {DISPOSITIONS.map((d) => (
            <Button
              key={d}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onDisposition(d)}
            >
              {DISPOSITION_LABELS[d]}
            </Button>
          ))}
        </div>
      </div>
      {lastLogged ? (
        <p className="text-xs text-emerald-700">Logged: {lastLogged} (mock)</p>
      ) : null}
    </div>
  );
}
