import { adminRequestJson } from "@/lib/admin-api/server";
import { parseOnboardingAttribution } from "@/lib/team-workspace/onboarding-attribution";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stored attribution" };

const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function OnboardingAttributionPage({
  params,
}: {
  params: Promise<{ clientAccountId: string; requestId: string }>;
}) {
  const { clientAccountId, requestId } = await params;
  if (!CLIENT_ID.test(clientAccountId) || !REQUEST_ID.test(requestId)) {
    return <Notice title="That address is not a stored request" body="The client id or request id is not valid. Nothing was read." />;
  }

  const path = `/admin/v1/clients/${clientAccountId}/onboarding-attribution/${requestId}`;
  const result = await adminRequestJson<unknown>("GET", path);
  if (!result.ok) {
    if (result.status === 401) {
      return <Notice title="The stored actor was not read" body="Sign in with the staff Google account, then open this page again." />;
    }
    if (result.status === 404) {
      return <Notice title="No stored request uses this id" body="Nothing was saved by this page." />;
    }
    if (result.status === 409) {
      return <Notice title="More than one stored record uses this id" body="No actor was chosen. Nothing was saved by this page." />;
    }
    return <Notice title="The stored actor was not read" body="This session cannot read that stored actor. Nothing was saved by this page." />;
  }

  const stored = parseOnboardingAttribution(result.data, requestId);
  if (!stored) {
    return <Notice title="The response did not include a stored actor" body="A success message is not attribution. No request was saved by this page." />;
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-lg font-semibold text-slate-950">Stored attribution</h1>
      <dl className="space-y-2 text-sm text-slate-800">
        <Row label="Record type" value={stored.recordType} />
        <Row label="Record id" value={stored.recordId} />
        <Row label="Request id" value={stored.requestId} />
        <Row label="Stored actor" value={stored.actor ?? "none"} />
      </dl>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium text-slate-950">{label}</dt>
      <dd className="font-mono break-all">{value}</dd>
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto max-w-xl space-y-3 p-6">
      <h1 className="text-lg font-semibold text-slate-950">{title}</h1>
      <p className="text-sm text-slate-700">{body}</p>
    </main>
  );
}
