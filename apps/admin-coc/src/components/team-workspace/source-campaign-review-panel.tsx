import Link from "next/link";

import {
  presentSourceCampaignReview,
  unavailableSourceCampaignReview,
  type SourceCampaignReviewView,
} from "@/lib/team-workspace/source-campaign-review";

const ROWS = [
  ["requested", "Requested"],
  ["sourceRegistered", "Source registered"],
  ["sourceOwnership", "Source ownership"],
  ["conflicts", "Conflicts or ambiguity"],
  ["campaignRule", "Campaign rule"],
  ["liveRouting", "Live routing"],
  ["deliveryEnabled", "Delivery enabled"],
  ["deliveryConfirmed", "Delivery confirmed"],
] as const;

export function SourceCampaignReviewPanel({
  clientAccountId,
  review,
  draftFunnelId,
  draftCampaignId,
}: {
  clientAccountId: string;
  review: SourceCampaignReviewView | null | undefined;
  draftFunnelId: string;
  draftCampaignId: string;
}) {
  const view = review ?? unavailableSourceCampaignReview("The source and campaign check could not be loaded. Nothing was verified.");
  const presented = presentSourceCampaignReview(view, clientAccountId, {
    providerFunnelId: draftFunnelId,
    providerCampaignId: draftCampaignId,
  });
  return (
    <section className="rounded-md border border-slate-200 bg-slate-50 p-3" aria-labelledby="source-campaign-review-title">
      <h3 id="source-campaign-review-title" className="text-sm font-medium text-slate-950">
        Saved request check
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        This reads the saved request against source and campaign records. It does not confirm a source, create a routing rule, or turn delivery on.
      </p>
      {presented.unsavedNote ? <p className="mt-2 text-sm text-slate-700">{presented.unsavedNote}</p> : null}
      <dl className="mt-3 grid gap-2">
        {ROWS.map(([key, label]) => (
          <div key={key} className="grid gap-0.5 sm:grid-cols-[11rem_1fr] sm:gap-3">
            <dt className="text-sm font-medium text-slate-800">{label}</dt>
            <dd className="text-sm text-slate-700">{presented[key]}</dd>
          </div>
        ))}
      </dl>
      {presented.attention.length > 0 ? (
        <div className="mt-3">
          <h4 className="text-sm font-medium text-slate-800">What still needs attention</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {presented.attention.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {presented.next ? (
        <p className="mt-3 text-sm">
          <Link href={presented.next.href} className="font-medium text-slate-950 underline">
            {presented.next.label}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
