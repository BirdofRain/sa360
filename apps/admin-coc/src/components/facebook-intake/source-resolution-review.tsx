import { WarningBanner } from "@/components/dashboard/warning-banner";

import {
  sourceResolutionClassificationLabel,
  type SourceResolutionReviewView,
} from "@/lib/facebook-intake/source-resolution";

function queryHref(input: {
  pageId?: string;
  formId?: string;
  classification?: string;
  offset?: number;
}): string {
  const params = new URLSearchParams();
  if (input.pageId) params.set("pageId", input.pageId);
  if (input.formId) params.set("formId", input.formId);
  if (input.classification) params.set("classification", input.classification);
  if (input.offset && input.offset > 0) params.set("offset", String(input.offset));
  const query = params.toString();
  return query ? `/facebook-intake/source-resolution?${query}` : "/facebook-intake/source-resolution";
}

export function SourceResolutionReview({
  review,
  error,
  pageId = "",
  formId = "",
  classification = "",
}: {
  review: SourceResolutionReviewView | null;
  error: string | null;
  pageId?: string;
  formId?: string;
  classification?: string;
}) {
  const offset = review?.groups.offset ?? 0;
  const limit = review?.groups.limit || 25;
  const total = review?.groups.total ?? 0;
  const confirmed = review?.associations.items.filter((item) => item.ownership === "confirmed") ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Source Resolution review</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Read-only view of Facebook SourceFunnel owners and unresolved Meta Lead Ads events.
          It does not change ownership, reevaluate leads, import candidates, or start delivery.
          Workbook client names are not loaded here.
        </p>
        <a className="mt-2 inline-block text-sm underline" href="/facebook-intake">
          Back to Facebook Intake
        </a>
      </div>

      {error ? (
        <WarningBanner tone="err" title="Source Resolution review unavailable">
          {error}
        </WarningBanner>
      ) : null}

      {review ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Summary label="Events" value={review.summary.events} />
            <Summary label="Unresolved client" value={review.summary.unresolvedClient} />
            <Summary
              label="Unresolved with a confirmed owner"
              value={review.summary.unstampedDespiteConfirmedOwner}
            />
            <Summary label="Cannot identify" value={review.summary.cannotIdentify} />
          </section>
          <p className="text-sm text-muted-foreground">
            Settled capture-only: {review.summary.settledCaptureOnly}. Unresolved events with a
            Page, Form, and campaign: {review.summary.unresolvedWithPageFormAndCampaign}. Statuses:{" "}
            {review.summary.byStatus.length === 0
              ? "none"
              : review.summary.byStatus.map((row) => `${row.status} ${row.events}`).join(", ")}
            .
          </p>

          <section className="space-y-3">
            <h2 className="font-medium">Confirmed SourceFunnel owners</h2>
            {confirmed.length === 0 ? (
              <p className="text-sm text-muted-foreground">No confirmed Facebook SourceFunnel owners in this view.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Page ID</th>
                      <th className="px-3 py-2 font-medium">Form ID</th>
                      <th className="px-3 py-2 font-medium">Origin client account</th>
                      <th className="px-3 py-2 font-medium">Ownership</th>
                    </tr>
                  </thead>
                  <tbody>
                    {confirmed.map((item) => (
                      <tr key={item.id} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs">{item.pageId}</td>
                        <td className="px-3 py-2 font-mono text-xs">{item.formId}</td>
                        <td className="px-3 py-2 font-mono text-xs">{item.originClientAccountId}</td>
                        <td className="px-3 py-2">Confirmed owner</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {review.associations.items.some((item) => item.ownership !== "confirmed") ? (
              <p className="text-sm text-muted-foreground">
                Suggested or unassociated SourceFunnel rows are listed as not confirmed. A suggestion is not ownership.
              </p>
            ) : null}
          </section>

          <form method="get" className="grid gap-3 rounded-xl border p-4 md:grid-cols-4">
            <label className="space-y-1 text-sm">
              Page ID
              <input
                name="pageId"
                defaultValue={pageId}
                inputMode="numeric"
                className="w-full rounded-md border bg-transparent px-2 py-1"
              />
            </label>
            <label className="space-y-1 text-sm">
              Form ID
              <input
                name="formId"
                defaultValue={formId}
                inputMode="numeric"
                className="w-full rounded-md border bg-transparent px-2 py-1"
              />
            </label>
            <label className="space-y-1 text-sm">
              Group
              <select
                name="classification"
                defaultValue={classification}
                className="w-full rounded-md border bg-transparent px-2 py-1"
              >
                <option value="">All unresolved groups</option>
                <option value="unstamped_confirmed_owner">Unresolved with a confirmed owner</option>
                <option value="unknown_ownership">Unknown ownership</option>
                <option value="cannot_identify">Cannot identify</option>
                <option value="ambiguous_owner">Ambiguous owner</option>
              </select>
            </label>
            <div className="flex items-end">
              <button type="submit" className="rounded-md border px-3 py-1 text-sm">
                Apply filter
              </button>
            </div>
          </form>

          <section className="space-y-3">
            <h2 className="font-medium">Unresolved events</h2>
            {review.groups.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No unresolved Meta Lead Ads events match this view.</p>
            ) : (
              review.groups.items.map((group) => (
                <article
                  key={`${group.pageId ?? "missing"}:${group.formId ?? "missing"}:${group.campaignId ?? "none"}`}
                  className="space-y-2 rounded-xl border p-4"
                >
                  <h3 className="font-medium">{sourceResolutionClassificationLabel(group.classification)}</h3>
                  <p className="text-sm text-muted-foreground">{group.explanation}</p>
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <div>Page ID: {group.pageId ?? "missing"}</div>
                    <div>Form ID: {group.formId ?? "missing"}</div>
                    <div>Campaign ID: {group.campaignId ?? "missing"}</div>
                    <div>Unresolved events: {group.unresolvedEvents}</div>
                    <div>Matching confirmed owner: {group.confirmedOriginClientAccountId ?? "none"}</div>
                    <div>
                      Settlement outcomes: unassociated {group.outcomes.unassociated}, association disabled{" "}
                      {group.outcomes.associationDisabled}, missing {group.outcomes.absent}
                    </div>
                  </dl>
                  {group.events.length > 0 ? (
                    <ul className="space-y-1 text-sm">
                      {group.events.map((event) => (
                        <li key={event.sourceEventId} className="font-mono text-xs">
                          {event.sourceEventId} · {event.status} · {event.storedAssociationOutcome}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))
            )}
            {total > limit ? (
              <div className="flex gap-3 text-sm">
                {offset > 0 ? (
                  <a
                    className="underline"
                    href={queryHref({
                      pageId,
                      formId,
                      classification,
                      offset: Math.max(0, offset - limit),
                    })}
                  >
                    Previous groups
                  </a>
                ) : null}
                {offset + limit < total ? (
                  <a
                    className="underline"
                    href={queryHref({ pageId, formId, classification, offset: offset + limit })}
                  >
                    Next groups
                  </a>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}
