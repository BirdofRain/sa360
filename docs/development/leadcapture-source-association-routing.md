# Confirmed LeadCapture source association → routing

A client's confirmed LeadCapture source (`SourceFunnel.associationStatus =
confirmed` with `originClientAccountId`) is now a routing authority. It
recognizes matching incoming LeadCapture events on both lanes
(`leadcapture_io_legacy`, `leadcapture_io_nextgen`) and can resolve
`destinationClientAccountId` when no exact `CampaignRoutingRule` exists.

Nothing here enables live delivery. Routing still produces a dry-run decision,
and a destination resolved from an association carries no `matchedRuleId`, so
shadow fulfillment and GHL/Sheets/webhook delivery stay unreachable.

## Identity signals

`leadcapture-source-identity-signals.ts` is the single extractor for both
lanes. It reads a provider payload (`...FromPayload`) or a persisted normalized
lifecycle payload (`...FromLifecyclePayload`) and produces:

| Signal | Meaning |
| --- | --- |
| `routeKey` | `sa360_route_key` / endpoint route key. Compatibility metadata, never a page identity. |
| `providerFormIds` | `funnel_id`, `form_id`, `sa360_form_id`, Legacy `lead_form` (e.g. `24133`), de-duplicated in that order. |
| `parentUrlKey` | Canonical `hostname + pathname`. |
| `parentUrlHostname` / `parentUrlPathname` | The two halves, for display and evidence. |
| `hostedPageSlug` | Last path segment, **only** when the host is `my.leadcapture.io`. |

URL identity always comes from `normalizeLeadCaptureParentUrl`: lowercase
hostname, scheme/query/fragment removed, trailing slash normalized, meaningful
pathname preserved. A custom domain keeps its hostname —
`https://go.lifeinsuranceforvets.com/learn-nicholas-dambruoso?utm_source=x`
normalizes to `go.lifeinsuranceforvets.com/learn-nicholas-dambruoso`.

The Legacy normalizer also materializes `parent_url_key`,
`parent_url_hostname`, `parent_url_pathname`, and `lead_form` onto
`routing.source_intake`, so persisted events carry the identity they matched on.

## Matching precedence

`resolveConfirmedLeadCaptureSourceAssociation` is the one reader used by
routing, inventory origin stamping, and operator reconciliation:

1. exact provider funnel/form id (`provider`, `providerFunnelId`)
2. exact `parentUrlKey` (normalized hostname + pathname)
3. known hosted slug, restricted to the `my.leadcapture.io` namespace, and only
   when exactly one confirmed row carries it
4. otherwise unmatched

Fail-closed rules:

- only `confirmed` + non-null origin matches; a registered-but-unconfirmed row
  returns `source_not_confirmed` with the row id for review and **stops** rather
  than falling through to a weaker signal that may belong to another client;
- more than one confirmed hosted slug returns `ambiguous_hosted_page_slug`;
- the configured route key is matching context, not a lookup key: route keys are
  not stored on `SourceFunnel`;
- client display names and UTM text never infer a destination.

A different domain carrying the same pathname never matches, because the
hostname is part of the identity and slug matching is namespace-scoped.

## Routing precedence

`runRoutingDryRun` consults authorities in this order:

1. **exact** `CampaignRoutingRule` tiers — `campaign_id`, `adset_id`, `ad_id`,
   `form_id_utm_campaign`
2. **confirmed source association** (this document)
3. **loose** `CampaignRoutingRule` tiers — `utm_campaign`, `keyword_fallback`

The decision records `routingAuthority` (`campaign_routing_rule`,
`confirmed_source_association`, or `operator_selected_destination`). When the
association outranks a loose rule, the evidence records
`overriddenLooseRuleId`, so the override is auditable instead of silent. No
rules are created: option A (direct destination resolution) was chosen over
generating rules, which keeps one source of truth per confirmed page.

`SourceLeadEvent.routingResultJson.sourceAssociation` carries the match
evidence (`matchedBy`, `matchEvidence`, `parentUrlKey`, `providerFunnelId`,
`pageSlug`, `routeKey`).

## Observation

Legacy intake observes the `SourceFunnel` the lead actually arrived from, so a
pre-registered confirmed source stops reading "Waiting for first lead" and
gains `firstSeenAt` / `lastSeenAt`. Observation never creates or changes a
confirmed origin.

## Reconciling an event that arrived before the fix

`pnpm source-intake:one-event-reconcile` operates on an existing
`SourceLeadEvent`. It does **not** re-POST the webhook: the Legacy lane inserts
a new event per request, so a resend would duplicate the lead.

Preview (no writes, the default):

```
pnpm source-intake:one-event-reconcile -- \
  --source-event-id <id> \
  --expected-source-system leadcapture_io_legacy \
  --expected-route <route key> \
  --expected-lead-id <lead id> \
  --expected-destination-client-account-id <client> \
  --expected-db-host <host or host:port> \
  --operator <name> \
  --confirm "RECONCILE ONE LEADCAPTURE SOURCE EVENT"
```

Add `--apply` to write. One apply, under a per-event advisory lock:

1. observes the `SourceFunnel` (`firstSeenAt` / `lastSeenAt`)
2. re-runs the normal routing pipeline on the stored raw + normalized payloads
3. lets the idempotent inventory tracker reuse or create the single inventory
   row for the event, then fills that row's origin client **only when it is
   still NULL** (the tracker stamps origin on create only)

It refuses, before any write, when: the confirmation phrase, operator, or DB
host do not match; the event's provider/system/route/lead id do not match the
operator's expectations; the event is not normalized; no confirmed association
matches; the association resolves to a different client than expected; more
than one inventory row already references the event; or any delivery-shaped
side effect already exists (fulfillment outbox, allocation, GHL delivery, Meta
dispatch). After applying it re-verifies the same invariants and fails the run
if anything duplicated or delivered.

Applying twice is safe: the second run reports `reused` inventory and an origin
stamp count of 0.
