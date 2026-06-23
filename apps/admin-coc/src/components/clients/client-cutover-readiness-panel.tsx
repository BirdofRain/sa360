import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  countSectionProgress,
  overallStatusBadgeClass,
  overallStatusLabel,
} from "@/lib/clients/cutover-readiness-display";
import type { ClientCutoverReadinessReport } from "@/lib/clients/cutover-readiness-types";
import { cn } from "@/lib/utils";

function ItemRow({
  complete,
  label,
  detail,
}: {
  complete: boolean;
  label: string;
  detail?: string;
}) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {complete ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
      ) : (
        <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className="min-w-0">
        <span className={cn(complete ? "text-foreground" : "text-foreground")}>{label}</span>
        {detail ? (
          <span className="ml-1 text-xs text-muted-foreground">— {detail}</span>
        ) : null}
      </span>
    </li>
  );
}

export function ClientCutoverReadinessPanel({
  report,
  quickLinks = true,
}: {
  report: ClientCutoverReadinessReport;
  quickLinks?: boolean;
}) {
  const clientHref = `/clients/${encodeURIComponent(report.clientAccountId)}`;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-950">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Cutover readiness
        </h2>
        <Badge
          variant="outline"
          className={cn("w-fit", overallStatusBadgeClass(report.overallStatus))}
        >
          {overallStatusLabel(report.overallStatus)}
        </Badge>
      </div>

      <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        Read-only readiness report. Cutover actions (approvals, live delivery, env allowlist, portal
        enablement) require manual operator steps and are not performed here.
      </p>

      {report.blockers.length > 0 ? (
        <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-950/40">
          <p className="text-xs font-semibold text-red-900 dark:text-red-100">Blockers</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-red-900 dark:text-red-100">
            {report.blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.warnings.length > 0 ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">Warnings</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-900 dark:text-amber-100">
            {report.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {report.sections.map((section) => {
          const progress = countSectionProgress(section);
          return (
            <div
              key={section.key}
              className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                  {section.label}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {progress.complete}/{progress.total}
                </span>
              </div>
              <ul className="mt-2 space-y-1">
                {section.items.map((item) => (
                  <ItemRow
                    key={item.key}
                    complete={item.complete}
                    label={item.label}
                    detail={item.detail}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {report.manualNextSteps.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Manual next steps
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-600 dark:text-slate-300">
            {report.manualNextSteps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {quickLinks ? (
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <Link
            href={`${clientHref}/delivery-config`}
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 font-medium"
          >
            Delivery config
          </Link>
          <Link
            href={clientHref}
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 font-medium"
          >
            Routing rules
          </Link>
          <Link
            href="/delivery-readiness"
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 font-medium"
          >
            Delivery readiness
          </Link>
          <Link
            href="/direct-delivery-demo"
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 font-medium"
          >
            Direct delivery demo
          </Link>
          <Link
            href="/ghl-connections"
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 font-medium"
          >
            GHL connections
          </Link>
        </div>
      ) : null}
    </section>
  );
}
