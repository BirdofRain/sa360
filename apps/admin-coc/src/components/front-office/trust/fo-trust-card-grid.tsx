"use client";

import { useState } from "react";

import {
  TRUST_STATUS_DISPLAY,
  formatRelativeTime,
} from "@/lib/front-office/display";
import type { TrustCheckCard } from "@/lib/front-office/types";
import { FoStatusPill } from "../shared/fo-status-pill";
import { FoTrustDetailDrawer } from "./fo-trust-detail-drawer";

export function FoTrustCardGrid({ cards }: { cards: TrustCheckCard[] }) {
  const [selected, setSelected] = useState<TrustCheckCard | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const style = TRUST_STATUS_DISPLAY[card.status];
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => {
                setSelected(card);
                setOpen(true);
              }}
              className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">{card.label}</h3>
                <FoStatusPill label={style.label} className={style.className} />
              </div>
              <p className="mt-2 text-xs text-slate-600">{card.headline}</p>
              <p className="mt-2 text-[11px] text-slate-400">
                Checked {formatRelativeTime(card.lastCheckedAt)}
              </p>
            </button>
          );
        })}
      </div>
      <FoTrustDetailDrawer card={selected} open={open} onOpenChange={setOpen} />
    </>
  );
}
