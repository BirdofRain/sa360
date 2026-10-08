"use client";

import { useState, useTransition } from "react";

import { WarningBanner } from "@/components/dashboard/warning-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type {
  MetaReviewActionResult,
  MetaReviewInsight,
  MetaReviewPage,
  MetaReviewPermission,
  MetaReviewPost,
  MetaReviewPreflight,
  MetaReviewSubscription,
  MetaReviewTrace,
} from "@/lib/meta-review/types";

type ResultState<T> = { data: T; error: string | null; trace: MetaReviewTrace | null };

function emptyResult<T>(data: T): ResultState<T> {
  return { data, error: null, trace: null };
}

function fromAction<T>(result: MetaReviewActionResult<T>, fallback: T): ResultState<T> {
  return result.ok
    ? { data: result.data, error: null, trace: result.trace }
    : { data: fallback, error: result.error, trace: result.trace };
}

function ApiTrace({ trace }: { trace: MetaReviewTrace | null }) {
  if (!trace) return null;
  return (
    <div className="mt-4 rounded-lg border bg-slate-50 p-3 text-xs" data-testid="meta-api-trace">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={trace.ok ? "secondary" : "destructive"}>
          HTTP {trace.httpStatus || "network error"}
        </Badge>
        <span className="font-mono">{trace.method}</span>
        <span className="break-all font-mono">{trace.endpoint}</span>
      </div>
      <div className="mt-1 text-slate-500">{trace.timestamp}</div>
      {trace.error ? (
        <div className="mt-2 text-red-700">
          {trace.error.code ? `Code ${trace.error.code}. ` : ""}
          {trace.error.message}
        </div>
      ) : (
        <div className="mt-2 text-emerald-700">Authorized Meta response applied to this panel.</div>
      )}
    </div>
  );
}

function PanelError({ message }: { message: string | null }) {
  return message ? (
    <WarningBanner tone="err" title="Meta request did not succeed">
      {message}
    </WarningBanner>
  ) : null;
}

export function MetaReviewPanel({
  preflight,
  defaultSince,
  defaultUntil,
  loadPages,
  loadPermissions,
  loadSubscription,
  loadPosts,
  loadInsights,
  subscribeLeadgen,
}: {
  preflight: MetaReviewPreflight;
  defaultSince: string;
  defaultUntil: string;
  loadPages: () => Promise<MetaReviewActionResult<MetaReviewPage[]>>;
  loadPermissions: () => Promise<MetaReviewActionResult<MetaReviewPermission[]>>;
  loadSubscription: (
    pageId: string
  ) => Promise<MetaReviewActionResult<MetaReviewSubscription[]>>;
  loadPosts: (pageId: string) => Promise<MetaReviewActionResult<MetaReviewPost[]>>;
  loadInsights: (input: {
    adAccountId: string;
    since: string;
    until: string;
  }) => Promise<MetaReviewActionResult<MetaReviewInsight[]>>;
  subscribeLeadgen: (input: {
    pageId: string;
    confirmed: boolean;
    confirmationText: string;
  }) => Promise<
    MetaReviewActionResult<{ alreadySubscribed: boolean; subscribedFields: string[] }>
  >;
}) {
  const [pending, startTransition] = useTransition();
  const [selectedPageId, setSelectedPageId] = useState(preflight.allowlists.pageIds[0] ?? "");
  const [adAccountId, setAdAccountId] = useState(preflight.allowlists.adAccountIds[0] ?? "");
  const [since, setSince] = useState(defaultSince);
  const [until, setUntil] = useState(defaultUntil);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [pages, setPages] = useState<ResultState<MetaReviewPage[]>>(emptyResult([]));
  const [permissions, setPermissions] =
    useState<ResultState<MetaReviewPermission[]>>(emptyResult([]));
  const [subscription, setSubscription] =
    useState<ResultState<MetaReviewSubscription[]>>(emptyResult([]));
  const [posts, setPosts] = useState<ResultState<MetaReviewPost[]>>(emptyResult([]));
  const [insights, setInsights] =
    useState<ResultState<MetaReviewInsight[]>>(emptyResult([]));
  const [writeResult, setWriteResult] = useState<
    ResultState<{ alreadySubscribed: boolean; subscribedFields: string[] } | null>
  >(emptyResult(null));

  function runPages() {
    startTransition(async () => {
      const result = await loadPages();
      const next = fromAction(result, []);
      setPages(next);
      if (result.ok && result.data[0]?.id) setSelectedPageId(result.data[0].id);
    });
  }

  function runPermissions() {
    startTransition(async () => {
      setPermissions(fromAction(await loadPermissions(), []));
    });
  }

  function runSubscription() {
    startTransition(async () => {
      setSubscription(fromAction(await loadSubscription(selectedPageId), []));
    });
  }

  function runPosts() {
    startTransition(async () => {
      setPosts(fromAction(await loadPosts(selectedPageId), []));
    });
  }

  function runInsights() {
    startTransition(async () => {
      setInsights(fromAction(await loadInsights({ adAccountId, since, until }), []));
    });
  }

  function runSubscribe() {
    startTransition(async () => {
      const result = await subscribeLeadgen({
        pageId: selectedPageId,
        confirmed,
        confirmationText,
      });
      setWriteResult(fromAction(result, null));
      if (result.ok) {
        setSubscription((current) => ({
          ...current,
          data: current.data.map((item) =>
            item.id
              ? { ...item, subscribedFields: [...new Set([...item.subscribedFields, "leadgen"])] }
              : item
          ),
        }));
      }
    });
  }

  const safety = preflight.productionSafety;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Meta App Review</h1>
            <Badge variant="outline">REAL API RESPONSES ONLY</Badge>
            <Badge variant={preflight.writesEnabled ? "destructive" : "secondary"}>
              WRITES {preflight.writesEnabled ? "ENABLED" : "DISABLED"}
            </Badge>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Permission-specific evidence for dedicated, allowlisted Meta review assets. Tokens,
            secrets, cookies, raw responses, and customer data never render in this interface.
          </p>
        </div>
        <Badge variant="secondary">{preflight.graphApiVersion}</Badge>
      </div>

      {!safety.safeForReview ? (
        <WarningBanner tone="err" title="Production intake safety check failed">
          Intake, Graph fetching, routing, and the legacy direct-intake alias must all remain off
          during review evidence collection.
        </WarningBanner>
      ) : (
        <WarningBanner tone="info" title="Review isolation checks pass">
          Direct intake, lead Graph fetching, routing, and the legacy direct-intake alias are off.
        </WarningBanner>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Read-only preflight</CardTitle>
          <CardDescription>
            Configuration presence only. Credential values are never returned.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">User/System User token</div>
            <div className="font-medium">
              {preflight.tokens.userOrSystemUser.configured ? "Configured (masked)" : "Missing"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Page token</div>
            <div className="font-medium">
              {preflight.tokens.page.configured ? "Configured (masked)" : "Missing"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Callback</div>
            <div className="font-medium">
              {preflight.callback.configured ? "Configured" : "Incomplete"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Allowlisted assets</div>
            <div className="font-medium">
              {preflight.allowlists.pageIds.length} Page ·{" "}
              {preflight.allowlists.adAccountIds.length} ad account
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>1. Connected Pages · pages_show_list</CardTitle>
            <CardDescription>
              Calls <span className="font-mono">GET /me/accounts</span> with the masked
              User/System User token and displays allowlisted Pages only.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={runPages} disabled={pending}>
              Load authorized Pages
            </Button>
            <PanelError message={pages.error} />
            {pages.data.length > 0 ? (
              <div className="space-y-2">
                {pages.data.map((page) => (
                  <div key={page.id} className="rounded-lg border p-3">
                    <div className="font-medium">{page.name ?? "Unnamed Page"}</div>
                    <div className="font-mono text-xs text-muted-foreground">{page.id}</div>
                    <div className="mt-1 text-xs">Tasks: {page.tasks.join(", ") || "none returned"}</div>
                  </div>
                ))}
              </div>
            ) : null}
            <ApiTrace trace={pages.trace} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Permission diagnostic</CardTitle>
            <CardDescription>
              Calls <span className="font-mono">GET /me/permissions</span> and shows only the five
              review-relevant permission statuses.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={runPermissions} disabled={pending} variant="outline">
              Check granted permissions
            </Button>
            <PanelError message={permissions.error} />
            {permissions.data.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2">Permission</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {permissions.data.map((item) => (
                      <tr className="border-t" key={item.permission}>
                        <td className="px-3 py-2 font-mono text-xs">{item.permission}</td>
                        <td className="px-3 py-2">{item.status ?? "not returned"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <ApiTrace trace={permissions.trace} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Selected dedicated Page</CardTitle>
          <CardDescription>
            Only IDs configured in <span className="font-mono">SA360_META_REVIEW_ALLOWED_PAGE_IDS</span>{" "}
            are accepted by the API.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Label htmlFor="meta-review-page">Page</Label>
          <Select
            id="meta-review-page"
            className="mt-1 max-w-xl"
            value={selectedPageId}
            onChange={(event) => setSelectedPageId(event.target.value)}
          >
            {preflight.allowlists.pageIds.map((id) => {
              const discovered = pages.data.find((page) => page.id === id);
              return (
                <option key={id} value={id}>
                  {discovered?.name ? `${discovered.name} · ` : ""}
                  {id}
                </option>
              );
            })}
          </Select>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>3. Leadgen subscription · pages_manage_metadata</CardTitle>
            <CardDescription>
              Readback is always read-only. Subscription POST requires the write flag, checkbox,
              exact confirmation text, and a duplicate check.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={runSubscription}
              disabled={pending || !selectedPageId}
              variant="outline"
            >
              Inspect subscribed apps
            </Button>
            <PanelError message={subscription.error} />
            {subscription.data.map((item, index) => (
              <div className="rounded-lg border p-3" key={item.id ?? `subscription-${index}`}>
                <div className="font-medium">{item.name ?? "Unnamed app"}</div>
                <div className="font-mono text-xs text-muted-foreground">{item.id ?? "No ID"}</div>
                <div className="mt-1 text-xs">
                  Fields: {item.subscribedFields.join(", ") || "none"}
                </div>
              </div>
            ))}
            <ApiTrace trace={subscription.trace} />

            <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <div className="font-medium text-amber-950">Operator-controlled external write</div>
              <label className="flex items-start gap-2 text-sm text-amber-950">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  disabled={!preflight.writesEnabled}
                />
                I confirm this is the dedicated test Page and subscription mutation is approved.
              </label>
              <div>
                <Label htmlFor="meta-review-confirmation">
                  Type <span className="font-mono">SUBSCRIBE LEADGEN</span>
                </Label>
                <Input
                  id="meta-review-confirmation"
                  value={confirmationText}
                  onChange={(event) => setConfirmationText(event.target.value)}
                  disabled={!preflight.writesEnabled}
                  autoComplete="off"
                />
              </div>
              <Button
                onClick={runSubscribe}
                disabled={
                  pending ||
                  !preflight.writesEnabled ||
                  !confirmed ||
                  confirmationText !== "SUBSCRIBE LEADGEN"
                }
                variant="destructive"
              >
                Subscribe leadgen
              </Button>
              {!preflight.writesEnabled ? (
                <div className="text-xs text-amber-900">
                  Disabled by SA360_META_REVIEW_WRITES_ENABLED=false.
                </div>
              ) : null}
              <PanelError message={writeResult.error} />
              {writeResult.data ? (
                <WarningBanner tone="info" title="Subscription operation completed">
                  {writeResult.data.alreadySubscribed
                    ? "No POST was sent; leadgen was already subscribed."
                    : "Meta accepted the authorized leadgen subscription POST."}
                </WarningBanner>
              ) : null}
              <ApiTrace trace={writeResult.trace} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>4. Page-owned content · pages_read_engagement</CardTitle>
            <CardDescription>
              Calls <span className="font-mono">GET /{"{page-id}"}/posts</span> for at most five
              Page-owned posts with a strict field list.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={runPosts} disabled={pending || !selectedPageId}>
              Load Page posts
            </Button>
            <PanelError message={posts.error} />
            {posts.data.map((post, index) => (
              <div className="rounded-lg border p-3" key={post.id ?? `post-${index}`}>
                <div className="text-sm">{post.message ?? "Post has no message text."}</div>
                <div className="mt-2 font-mono text-xs text-muted-foreground">
                  {post.id ?? "No ID"} · {post.createdTime ?? "No timestamp"}
                </div>
              </div>
            ))}
            <ApiTrace trace={posts.trace} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>5. Campaign insights · ads_read</CardTitle>
          <CardDescription>
            Calls the allowlisted ad account at campaign level with a required explicit date
            range. No ad creative, audiences, or lead data are requested.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <Label htmlFor="meta-review-ad-account">Ad account</Label>
              <Select
                id="meta-review-ad-account"
                value={adAccountId}
                onChange={(event) => setAdAccountId(event.target.value)}
              >
                {preflight.allowlists.adAccountIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="meta-review-since">Since</Label>
              <Input
                id="meta-review-since"
                type="date"
                value={since}
                onChange={(event) => setSince(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="meta-review-until">Until</Label>
              <Input
                id="meta-review-until"
                type="date"
                value={until}
                onChange={(event) => setUntil(event.target.value)}
              />
            </div>
          </div>
          <Button onClick={runInsights} disabled={pending || !adAccountId || !since || !until}>
            Load campaign insights
          </Button>
          <PanelError message={insights.error} />
          {insights.data.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2">Campaign</th>
                    <th className="px-3 py-2">Impressions</th>
                    <th className="px-3 py-2">Spend</th>
                    <th className="px-3 py-2">Range</th>
                  </tr>
                </thead>
                <tbody>
                  {insights.data.map((item, index) => (
                    <tr className="border-t" key={item.campaignId ?? `insight-${index}`}>
                      <td className="px-3 py-2">
                        <div>{item.campaignName ?? "Unnamed campaign"}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {item.campaignId ?? "No ID"}
                        </div>
                      </td>
                      <td className="px-3 py-2">{item.impressions ?? "0"}</td>
                      <td className="px-3 py-2">{item.spend ?? "0"}</td>
                      <td className="px-3 py-2 text-xs">
                        {item.dateStart ?? since} – {item.dateStop ?? until}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <ApiTrace trace={insights.trace} />
        </CardContent>
      </Card>
    </div>
  );
}
