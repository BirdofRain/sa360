import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { DiscoverySource, DiscoveryTriState, OnboardingDiscoveryModel } from "@/lib/clients/onboarding-discovery";
import {
  formatSourceFunnelLeadTimestamp,
  sourceFunnelAssociationLabel,
  SOURCE_FUNNEL_NO_LEAD_YET,
} from "@/lib/clients/source-funnels";

export function OnboardingDiscoveryPanel({
  clientAccountId,
  model,
}: {
  clientAccountId: string;
  model: OnboardingDiscoveryModel;
}) {
  return (
    <section
      aria-labelledby="onboarding-discovery-heading"
      className="rounded-xl border border-slate-200 bg-white shadow-sm"
      data-testid="onboarding-discovery"
    >
      <div className="border-b border-slate-200 p-4">
        <h2 id="onboarding-discovery-heading" className="text-lg font-semibold">
          Records already stored
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sources and destinations already recorded for this client. This summary only reads.
          It does not associate a source, change a destination, share a file, or enable delivery.
        </p>
      </div>
      <div className="grid gap-6 p-4">
        <div>
          <h3 className="text-sm font-semibold">Setup progress</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Each line comes from a stored record. A setup checkbox or an administrative review is not
            technical verification.
          </p>
          <ul className="mt-3 grid gap-2">
            {model.checks.map((item) => (
              <li key={item.id} className="rounded-md border border-slate-200 px-3 py-2" data-testid={`discovery-check-${item.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{item.label}</span>
                  <Badge variant="outline">{item.statusLabel}</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-600">{item.detail}</p>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold">Lead sources</h3>
          {model.sourcesAvailability !== "ready" ? (
            <p className="mt-2 text-sm text-amber-900" role="status">
              Source records could not be loaded. Nothing here was marked missing.
            </p>
          ) : model.sources.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No source pages are stored for this client. Advanced configuration can associate one.
              This summary will not.
            </p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {model.sources.map((source) => (
                <SourceCard key={source.id} source={source} />
              ))}
            </ul>
          )}
          <CampaignList model={model} />
        </div>

        <DestinationSection clientAccountId={clientAccountId} model={model} />

        <p className="text-sm text-slate-700">
          Advanced configuration remains available for source association and client edits during
          this migration. Those tools can write operational records.
        </p>
        <div className="flex flex-wrap gap-3 text-xs">
          <a href="#advanced-configuration" className="text-sky-700 hover:underline">
            Open advanced configuration
          </a>
          <Link href={`/clients/${encodeURIComponent(clientAccountId)}/google-sheets`} className="text-sky-700 hover:underline">
            Company Google Sheets
          </Link>
          <Link href={`/clients/${encodeURIComponent(clientAccountId)}/delivery-config`} className="text-sky-700 hover:underline">
            GHL destination configuration
          </Link>
          <Link href={`/clients/${encodeURIComponent(clientAccountId)}/onboarding`} className="text-sky-700 hover:underline">
            Setup & Delivery
          </Link>
        </div>
      </div>
    </section>
  );
}

function SourceCard({ source }: { source: DiscoverySource }) {
  const firstLead = formatSourceFunnelLeadTimestamp(source.firstLeadAt);
  const lastLead = formatSourceFunnelLeadTimestamp(source.lastLeadAt);
  return (
    <li className="rounded-md border border-slate-200 px-3 py-2" data-testid={`discovery-source-${source.id}`}>
      <p className="text-sm font-medium">{source.name}</p>
      <dl className="mt-2 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
        <Fact label="Identified" value={source.identified === "yes" ? "Identified" : "Not identified"} />
        <Fact label="Observed" value={source.observed === "yes" ? "Observed" : "Not observed"} />
        <Fact
          label="Associated"
          value={source.associated === "yes" ? "Associated" : source.associationStatus === "suggested" ? "Suggested, not associated" : "Not associated"}
        />
        <Fact label="Verified" value={verifiedLabel(source.verified)} />
        <Fact label="Association status" value={sourceFunnelAssociationLabel({ associationStatus: source.associationStatus })} />
        <Fact label="Provider" value={source.provider} />
        <Fact label="Traffic platform" value={source.trafficPlatform ?? "Unknown"} />
        <Fact label="Public URL" value={source.publicUrl ?? "Unknown"} mono />
        <Fact label="Provider funnel id" value={source.providerFunnelId ?? "Unknown"} mono />
        <Fact label="First lead" value={source.firstLeadAt ? firstLead ?? "Unknown" : SOURCE_FUNNEL_NO_LEAD_YET} />
        <Fact label="Last lead" value={source.lastLeadAt ? lastLead ?? "Unknown" : SOURCE_FUNNEL_NO_LEAD_YET} />
        <Fact label="Source event id" value={source.sourceEventId ?? "Unknown"} mono />
        <Fact
          label="Submission time"
          value={source.observedSubmissionAt ? formatSourceFunnelLeadTimestamp(source.observedSubmissionAt) ?? "Unknown" : "Unknown"}
        />
        <Fact label="Provider lead UUID" value="Unknown" />
        <Fact label="Matched routing rule" value={source.matchedRuleId ?? "Unknown"} mono />
      </dl>
      {source.campaignIdentifiers.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Campaign identifiers: Unknown</p>
      ) : (
        <ul className="mt-2 grid gap-1">
          {source.campaignIdentifiers.map((identifier) => (
            <li key={`${identifier.label}-${identifier.value}`} className="text-xs">
              <span className="text-muted-foreground">{identifier.label}: </span>
              <span className="font-mono">{identifier.value}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Verification uses a stored source event. Confirming an association does not verify the source,
        and the provider lead UUID is not on this read.
      </p>
    </li>
  );
}

function CampaignList({ model }: { model: OnboardingDiscoveryModel }) {
  return (
    <div className="mt-4">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
        Routing campaign identifiers
      </h4>
      {model.clientCampaigns.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">No routing rules are stored for this client.</p>
      ) : (
        <ul className="mt-2 grid gap-2">
          {model.clientCampaigns.map((rule) => (
            <li key={rule.ruleId} className="text-xs text-slate-700">
              <span className="font-mono">{rule.ruleId}</span>
              {": "}
              campaign id {rule.campaignId ?? "Unknown"}, name {rule.campaignName ?? "Unknown"}, UTM{" "}
              {rule.utmCampaign ?? "Unknown"}. {rule.deliveryEnabled ? "Delivery enabled." : "Delivery off."}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DestinationSection({
  clientAccountId,
  model,
}: {
  clientAccountId: string;
  model: OnboardingDiscoveryModel;
}) {
  const requested = model.requestedDestination;
  return (
    <div>
      <h3 className="text-sm font-semibold">Delivery destinations</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        A requested destination is the setup request. An operational destination is the stored
        Google Sheets or GoHighLevel configuration. They are not the same record.
      </p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <article className="rounded-md border border-slate-200 p-3">
          <h4 className="text-sm font-medium">Requested destination</h4>
          {requested.availability === "disabled" ? (
            <p className="mt-2 text-xs text-slate-600">Native client setup is off, so no setup request was read.</p>
          ) : requested.availability === "unavailable" ? (
            <p className="mt-2 text-xs text-amber-900" role="status">
              The setup request could not be loaded. It is not treated as empty.
            </p>
          ) : (
            <dl className="mt-2 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
              <Fact label="Choice" value={requested.choice ? requested.choice.replaceAll("_", " ") : "None requested"} />
              <Fact label="Request status" value={requested.status ?? "Unknown"} />
              <Fact label="Request revision" value={requested.revision == null ? "Unknown" : String(requested.revision)} />
            </dl>
          )}
        </article>
        <article className="rounded-md border border-slate-200 p-3">
          <h4 className="text-sm font-medium">Operational Google Sheets</h4>
          <SheetsBody model={model} />
        </article>
        <article className="rounded-md border border-slate-200 p-3">
          <h4 className="text-sm font-medium">Operational GoHighLevel</h4>
          {model.ghl.configured ? (
            <dl className="mt-2 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
              <Fact label="Location id" value={model.ghl.locationId ?? "Unknown"} mono />
              <Fact label="Location name" value={model.ghl.locationName ?? "Unknown"} />
              <Fact label="Connection status" value={model.ghl.connectionStatus ?? "Unknown"} />
              <Fact label="Delivery" value={model.ghl.deliveryEnabled ? "Enabled" : "Off"} />
            </dl>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">No GoHighLevel destination is stored.</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Connection status is not a permission verification. Change it from{" "}
            <Link href={`/clients/${encodeURIComponent(clientAccountId)}/delivery-config`} className="text-sky-700 hover:underline">
              GHL destination configuration
            </Link>
            .
          </p>
        </article>
        <article className="rounded-md border border-slate-200 p-3">
          <h4 className="text-sm font-medium">Share spreadsheet with (email)</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Optional sharing note on the stored destination. This page does not share the file or
            grant client access.
          </p>
          <dl className="mt-2 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
            <Fact label="Email" value={model.sheets.sharingEmail ?? "Unknown"} />
            <Fact label="Client Google permission" value={model.sheets.sharingPermission ?? "Unknown"} />
          </dl>
        </article>
      </div>
    </div>
  );
}

function SheetsBody({ model }: { model: OnboardingDiscoveryModel }) {
  return (
    <>
      {model.sheets.availability !== "ready" ? (
        <p className="mt-2 text-xs text-amber-900" role="status">
          The Company Sheets destination could not be loaded. It is not treated as unconfigured.
        </p>
      ) : model.sheets.configured ? (
        <dl className="mt-2 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
          <Fact label="Spreadsheet" value={model.sheets.spreadsheetTitle ?? "Unknown"} />
          <Fact label="Spreadsheet URL" value={model.sheets.spreadsheetUrl ?? "Unknown"} mono />
          <Fact label="Worksheet" value={model.sheets.worksheetTitle ?? "Unknown"} />
          <Fact label="Access status" value={model.sheets.accessStatus ?? "Unknown"} />
          <Fact label="Write readiness" value={model.sheets.writeReadiness ?? "Unknown"} />
          <Fact label="Destination revision" value={model.sheets.revision == null ? "Unknown" : String(model.sheets.revision)} />
        </dl>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No Company Sheets destination is stored.</p>
      )}
      <dl className="mt-2 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
        <Fact label="Google account" value={model.google.availability === "ready" ? model.google.email ?? "Unknown" : "Unknown"} />
        <Fact
          label="Google connection"
          value={model.google.availability === "ready" ? model.google.connectionStatus ?? "Unknown" : "Unknown"}
        />
        <Fact
          label="Client Folders root"
          value={model.google.availability === "ready" ? model.google.rootFolderTitle ?? "Unknown" : "Unknown"}
        />
        <Fact label="Client folder" value={folderLabel(model)} />
      </dl>
      <FolderSpreadsheets model={model} />
      {model.sheets.superseded.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs font-medium text-slate-700">Superseded spreadsheet links</p>
          <ul className="mt-1 grid gap-1">
            {model.sheets.superseded.map((link) => (
              <li key={`${link.spreadsheetId}-${link.supersededAt}`} className="text-xs text-slate-600">
                {link.title ?? link.spreadsheetId} superseded {link.supersededAt}. This is not the current destination.
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function FolderSpreadsheets({ model }: { model: OnboardingDiscoveryModel }) {
  if (model.clientFolder.availability !== "ready") {
    return (
      <p className="mt-2 text-xs text-amber-900" role="status">
        Spreadsheets in the client folder could not be loaded.
      </p>
    );
  }
  if (!model.clientFolder.title) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        No client folder is associated. The company Client Folders root is not used as this client&apos;s folder.
      </p>
    );
  }
  if (!model.clientFolder.spreadsheets || model.clientFolder.spreadsheets.length === 0) {
    return <p className="mt-2 text-xs text-muted-foreground">The associated folder has no spreadsheets in the stored list.</p>;
  }
  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-slate-700">Spreadsheets in the associated folder</p>
      <ul className="mt-1 grid gap-1">
        {model.clientFolder.spreadsheets.map((sheet) => (
          <li key={sheet.spreadsheetId} className="text-xs">
            <span className="font-medium">{sheet.title}</span>
            {model.sheets.spreadsheetId === sheet.spreadsheetId ? " — current destination" : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function folderLabel(model: OnboardingDiscoveryModel): string {
  if (model.clientFolder.availability !== "ready") return "Unknown";
  return model.clientFolder.title ?? "None associated";
}

function verifiedLabel(state: DiscoveryTriState): string {
  if (state === "yes") return "Verified";
  if (state === "no") return "Not verified";
  return "Unknown";
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "break-all font-mono text-slate-900" : "break-all text-slate-900"}>{value}</dd>
    </>
  );
}
