import { SectionPanel } from "@/components/dashboard/section-panel";
import { formatPortalDisplayLabel } from "@/lib/client-portal/portal-labels";

function AccountDetail({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  if (!value?.trim()) return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function formatList(values: string[] | undefined): string | null {
  const labels = (values ?? [])
    .map((value) => formatPortalDisplayLabel(value))
    .filter(Boolean);
  return labels.length ? labels.join(" · ") : null;
}

export function PortalAccountPanel({
  displayName,
  loginEmail,
  nicheLabels,
  productLabels,
}: {
  displayName: string;
  loginEmail?: string | null;
  nicheLabels?: string[];
  productLabels?: string[];
}) {
  return (
    <SectionPanel title="Your account">
      <dl className="grid gap-4 p-4 sm:grid-cols-2">
        <AccountDetail label="Business" value={displayName} />
        <AccountDetail label="Signed in as" value={loginEmail || "—"} />
        <AccountDetail label="Lead focus" value={formatList(nicheLabels)} />
        <AccountDetail label="Product types" value={formatList(productLabels)} />
      </dl>
    </SectionPanel>
  );
}
