"use client";

import { CocDetailViewShell } from "@/components/CocDetailViewShell";
import { TRUST_STATUS_DISPLAY } from "@/lib/front-office/display";
import type { TrustCheckCard } from "@/lib/front-office/types";
import { FoStatusPill } from "../shared/fo-status-pill";
import { useFrontOfficeSession } from "../shell/front-office-session-context";

export function FoTrustDetailDrawer({
  card,
  open,
  onOpenChange,
}: {
  card: TrustCheckCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const session = useFrontOfficeSession();
  const isAdmin = session.role === "admin";

  return (
    <CocDetailViewShell
      open={open}
      onOpenChange={onOpenChange}
      title={card?.label ?? "Trust check"}
      subtitle={card?.headline}
    >
      {card ? (
        <div className="space-y-4">
          {isAdmin && card.source ? (
            <p className="text-[11px] uppercase tracking-wide text-slate-400">
              Source: {card.source}
            </p>
          ) : null}
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
            {card.checks.map((check) => {
              const style = TRUST_STATUS_DISPLAY[check.status];
              return (
                <li key={check.id} className="px-3 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800">{check.label}</span>
                    <FoStatusPill label={style.label} className={style.className} />
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{check.detail}</p>
                  {isAdmin && check.adminDetail ? (
                    <p className="mt-1 text-xs text-slate-400">{check.adminDetail}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </CocDetailViewShell>
  );
}
