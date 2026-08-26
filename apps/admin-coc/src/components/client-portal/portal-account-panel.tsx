import { Building2 } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { SectionPanel } from "@/components/dashboard/section-panel";
import { formatRelativeTime } from "@/lib/client-portal/map-client-dashboard";
import {
  portalTrustStatusTone,
  type PortalTrustView,
} from "@/lib/client-portal/map-client-trust";
import { formatPortalDisplayLabel } from "@/lib/client-portal/portal-labels";

import { PortalStatusPill } from "./portal-status-pill";

export function PortalAccountPanel({
  displayName,
  loginEmail,
  locationLabel,
  nicheLabels,
  productLabels,
  trust,
}: {
  displayName: string;
  loginEmail?: string | null;
  locationLabel?: string | null;
  nicheLabels?: string[];
  productLabels?: string[];
  trust: PortalTrustView | null;
}) {
  const focus = [
    ...(nicheLabels?.length ? [nicheLabels.map((l) => formatPortalDisplayLabel(l)).join(" · ")] : []),
    ...(productLabels?.length
      ? [productLabels.map((l) => formatPortalDisplayLabel(l)).join(" · ")]
      : []),
  ].join(" · ");

  return (
    <div className="space-y-6">
      <SectionPanel title="Account">
        <dl className="grid gap-4 p-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">Business</dt>
            <dd className="mt-0.5 text-sm font-medium text-slate-900">{displayName}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Signed in as</dt>
            <dd className="mt-0.5 text-sm text-slate-800">{loginEmail || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Location</dt>
            <dd className="mt-0.5 text-sm text-slate-800">{locationLabel || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Focus</dt>
            <dd className="mt-0.5 text-sm text-slate-800">{focus || "—"}</dd>
          </div>
        </dl>
      </SectionPanel>

      <SectionPanel title="Account status">
        {!trust || trust.cards.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="Status checks are not available"
            hint="Connection and setup status will appear here when your account checks are ready."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {trust.cards.map((card) => (
              <li key={card.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800">{card.title}</div>
                  <div className="text-sm text-slate-500">{card.summary}</div>
                  {card.warnings[0] ? (
                    <div className="mt-1 text-xs text-amber-700">{card.warnings[0]}</div>
                  ) : null}
                </div>
                <PortalStatusPill
                  label={card.statusLabel}
                  tone={portalTrustStatusTone(card.status)}
                />
              </li>
            ))}
          </ul>
        )}
        {trust?.generatedAt ? (
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
            Checked {formatRelativeTime(trust.generatedAt)}
          </p>
        ) : null}
      </SectionPanel>
    </div>
  );
}
