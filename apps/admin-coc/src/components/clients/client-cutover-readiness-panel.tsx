import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  countSectionProgress,
  isGhlDestinationBlocker,
  isLegacyRoutingRuleBlocker,
  legacyMasterRoutingApplicability,
  legacyRoutingApplicabilityLabel,
  overallStatusBadgeClass,
  overallStatusLabel,
} from "@/lib/clients/cutover-readiness-display";
import type {
  ClientCutoverReadinessReport,
  CutoverReadinessSection,
} from "@/lib/clients/cutover-readiness-types";
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

function sectionHeading(section: CutoverReadinessSection): string {
  if (section.key === "routing_rules") return "Legacy master-source routing rules";
  return section.label;
}

function SectionCard({ section }: { section: CutoverReadinessSection }) {
  const progress = countSectionProgress(section);
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
          {sectionHeading(section)}
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
}

export function ClientCutoverReadinessPanel({
  report,
  quickLinks = true,
}: {
  report: ClientCutoverReadinessReport;
  quickLinks?: boolean;
}) {
  const clientHref = `/clients/${encodeURIComponent(report.clientAccountId)}`;
  const applicability = legacyMasterRoutingApplicability(report);
  const destinationSection = report.sections.find((section) => section.key === "ghl_destination") ?? null;
  const legacySections = report.sections.filter((section) => section.key !== "ghl_destination");
  const destinationBlockers = report.blockers.filter(isGhlDestinationBlocker);
  const routingBlockers = report.blockers.filter(isLegacyRoutingRuleBlocker);
  const otherBlockers = report.blockers.filter(
    (blocker) => !isGhlDestinationBlocker(blocker) && !isLegacyRoutingRuleBlocker(blocker)
  );

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-950"
      data-testid="legacy-cutover-readiness"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Legacy / master-routed cutover readiness
        </h2>
        <Badge
          variant="outline"
          className={cn("w-fit", overallStatusBadgeClass(report.overallStatus))}
        >
          {overallStatusLabel(report.overallStatus)}
        </Badge>
      </div>

      <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        This report is the legacy master-source cutover checklist. Its routing-rule requirement applies to that
        delivery model. It does not show that a GHL connection, workflow mapping, or Company Sheets destination is
        misconfigured. Approvals, delivery switches, and the checklist results are unchanged. Cutover actions stay
        manual and are not performed here.
      </p>

      {destinationSection ? (
        <div
          className="mt-4 rounded-lg border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-900 dark:bg-sky-950/30"
          data-testid="ghl-destination-configuration-readiness"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wide text-sky-950 dark:text-sky-100">
            GHL destination configuration readiness
          </h3>
          <p className="mt-1 text-xs text-sky-950 dark:text-sky-100">
            Separate from routing and from the legacy cutover status above. A missing routing rule is not a
            destination configuration failure.
          </p>
          <ul className="mt-2 space-y-1">
            {destinationSection.items.map((item) => (
              <ItemRow key={item.key} complete={item.complete} label={item.label} detail={item.detail} />
            ))}
          </ul>
          {destinationBlockers.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-sky-950 dark:text-sky-100">
              {destinationBlockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-sky-950 dark:text-sky-100">No GHL destination configuration blockers in this report.</p>
          )}
        </div>
      ) : null}

      <div
        className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
        data-testid="legacy-routing-applicability"
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
          Legacy routing-rule applicability
        </h3>
        <p className="mt-1 text-sm text-slate-800 dark:text-slate-100">
          {legacyRoutingApplicabilityLabel(applicability)}
        </p>
        {applicability === "legacy_master_source" ? (
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            This client has an active routing rule with a master source. The routing-rule requirement applies to that
            delivery model. This screen does not create a routing rule.
          </p>
        ) : (
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            Applicability is unknown. This report cannot tell whether this client uses legacy master-source routing or
            source-based onboarding. A missing routing rule is not treated as proof that routing is unnecessary, and
            it is not a GHL setup requirement.
          </p>
        )}
        {routingBlockers.length > 0 ? (
          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-slate-700 dark:text-slate-200">
            {routingBlockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {otherBlockers.length > 0 ? (
        <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-950/40">
          <p className="text-xs font-semibold text-red-900 dark:text-red-100">Other cutover blockers</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-red-900 dark:text-red-100">
            {otherBlockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.warnings.length > 0 ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">Warnings</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-900 dark:text-amber-100">
            {report.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {legacySections.map((section) => (
          <SectionCard key={section.key} section={section} />
        ))}
      </div>

      {report.manualNextSteps.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Manual next steps
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-600 dark:text-slate-300">
            {report.manualNextSteps.map((step) => (
              <li key={step}>
                {step}
                {step.startsWith("Create an active routing rule") && applicability === "unknown"
                  ? " Applicability to this client is unknown. This is not a GHL destination step."
                  : null}
              </li>
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
