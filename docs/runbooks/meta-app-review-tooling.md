# Meta App Review tooling

Status: implementation only. No Meta asset was accessed, no Page was subscribed, and no App
Review submission was made while preparing this tooling.

The Admin C.O.C. route `/meta-review` is an evidence surface for dedicated review assets. It is
not an OAuth onboarding flow and it is not a general Graph API proxy. Both the Next.js page and
the Fastify routes are disabled unless `SA360_META_REVIEW_ENABLED=true`.

## Environment matrix

Set these values only on the API and Admin C.O.C. staging components that need them. Secret
values must use the hosting platform's encrypted-secret setting and must never use a
`NEXT_PUBLIC_` name.

| Variable | Component | Secret | Default | Purpose / exact token type |
| --- | --- | --- | --- | --- |
| `SA360_META_REVIEW_ENABLED` | API + Admin C.O.C. | No | `false` | Enables `/meta-review` and its narrowly defined admin API routes. |
| `SA360_META_REVIEW_WRITES_ENABLED` | API | No | `false` | Enables only duplicate-safe `leadgen` Page subscription POST. Keep false until separately approved. |
| `SA360_META_REVIEW_ALLOWED_PAGE_IDS` | API | No | empty | Comma-separated numeric IDs for dedicated test Pages. Every Page read/write fails closed outside this list. |
| `SA360_META_REVIEW_ALLOWED_AD_ACCOUNT_IDS` | API | No | empty | Comma-separated dedicated test ad-account IDs, with or without `act_`. |
| `META_REVIEW_USER_ACCESS_TOKEN` | API | **Yes** | unset | User access token for `/me/accounts` and `/me/permissions`, or a System User access token assigned to the dedicated Page/ad account where Meta supports the requested edge. Also used for `ads_read` insights. |
| `META_PAGE_ACCESS_TOKEN` | API | **Yes** | unset | Page access token for the single dedicated test Page; used for `subscribed_apps` and Page-owned posts. Existing lead retrieval uses the same token. |
| `META_PAGE_ACCESS_TOKEN_PAGE_ID` | API | No | unset | Must equal the dedicated Page ID to preserve lead retrieval's Page binding. |
| `META_REVIEW_APP_ID` | API | No | unset | SA360 Meta app ID. Required before subscription writes so readback can detect an existing `leadgen` subscription. |
| `META_APP_SECRET` | API | **Yes** | unset | Existing app secret for webhook signatures and optional `appsecret_proof`; never returned. |
| `META_WEBHOOK_VERIFY_TOKEN` | API | **Yes** | unset | Existing callback verification token. Preflight reports presence only. |
| `META_GRAPH_API_VERSION` | API | No | `v25.0` | Version prefix for every review call and existing lead retrieval. |

Required safe values during review:

```text
FACEBOOK_DIRECT_INTAKE_ENABLED=false (prefer unset)
SA360_META_LEAD_ADS_INTAKE_ENABLED=false
SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED=false
SA360_META_LEAD_ADS_ROUTING_ENABLED=false
SA360_META_REVIEW_WRITES_ENABLED=false
```

Do not set `FACEBOOK_DIRECT_INTAKE_ENABLED=true`: that legacy alias enables intake, Graph
retrieval, and routing together.

## Token provisioning — operator controlled

Use a role-holding operator and dedicated Business assets. Do not paste tokens into the UI,
recording, tickets, chat, source control, shell history, or browser developer tools.

1. In Meta Business Settings, create or select the dedicated review System User.
2. Assign only the dedicated test Page and ad account. Grant the minimum Page tasks needed for
   Page management/content read and ad-account view/analysis access.
3. Generate a token for the SA360 Meta app with only the permissions already under review:
   `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`, `ads_read`, and the
   already-submitted `leads_retrieval` permission when validating lead retrieval.
4. Store that token as `META_REVIEW_USER_ACCESS_TOKEN` in the staging API secret store.
5. Obtain the dedicated Page access token through Meta's supported Business/System User asset
   flow or from the role-holding user's `/me/accounts` response. Store it as
   `META_PAGE_ACCESS_TOKEN`; bind `META_PAGE_ACCESS_TOKEN_PAGE_ID` to the same Page.
6. Set the two allowlists to only the dedicated Page and ad account.
7. Restart staging components without displaying environment values.
8. Open `/meta-review`. Confirm preflight says both tokens are configured (masked), callback
   configuration is present, one dedicated Page/ad account is allowlisted, and all intake/routing
   flags are off.

If `/me/accounts` does not support the generated System User token for the assigned assets, use
a role-holding test user's access token for Page discovery. Do not add `business_management` or
another permission merely to work around an incorrect asset assignment.

## API route inventory

Every route requires `x-sa360-admin-key`; the browser reaches it only through admin-role server
actions. Feature-disabled calls return 404.

| SA360 route | Graph operation | Token | Permission | Side effect |
| --- | --- | --- | --- | --- |
| `GET /admin/v1/meta-review/preflight` | None | None | None | None |
| `GET /admin/v1/meta-review/pages` | `GET /v25.0/me/accounts?fields=id,name,tasks` | User/System User | `pages_show_list` + Meta's required Page metadata access | None |
| `GET /admin/v1/meta-review/permissions` | `GET /v25.0/me/permissions` | User/System User | Token diagnostic | None |
| `GET /admin/v1/meta-review/pages/:pageId/subscription` | `GET /v25.0/{page-id}/subscribed_apps` | Page | `pages_manage_metadata` | None |
| `GET /admin/v1/meta-review/pages/:pageId/posts` | `GET /v25.0/{page-id}/posts` | Page | `pages_read_engagement` | None |
| `GET /admin/v1/meta-review/ad-accounts/:id/insights` | `GET /v25.0/act_{id}/insights` | User/System User | `ads_read` and ad-account access | None |
| `POST /admin/v1/meta-review/pages/:pageId/subscribe-leadgen` | Readback, then `POST /v25.0/{page-id}/subscribed_apps?subscribed_fields=leadgen` | Page | `pages_manage_metadata` | Page subscription; write flag, confirmation, allowlist, duplicate, and intake-safety gated |

The API requests only fixed fields and limits: 50 Pages, 25 subscribed apps, five Page posts,
and 25 campaign insight rows. Returned objects are projected onto fixed response schemas; raw
Graph bodies, paging URLs, headers, tokens, proofs, and Meta trace IDs are not exposed.

## Operator-controlled test plan

Complete these steps in staging with `SA360_META_REVIEW_WRITES_ENABLED=false`:

1. **Preflight:** confirm masked tokens, `v25.0`, callback configured, exact allowlists, and
   `safeForReview=true`.
2. **Permission status:** click **Check granted permissions**. Record the real status of each
   returned permission; do not describe a missing/declined permission as granted.
3. **Page discovery:** click **Load authorized Pages**. The dedicated Page must be returned by
   Meta and selected. A configured Page absent from the response is a failed test.
4. **Subscription readback:** click **Inspect subscribed apps**. Record whether the SA360 app
   already has `leadgen`. Do not enable writes if it is already subscribed.
5. **Page content:** click **Load Page posts**. The result must contain a real Page-owned post,
   or clearly show the authentic empty/error state.
6. **Ads reporting:** select the allowlisted ad account and a narrow date range, then click
   **Load campaign insights**. Record real campaign ID/name, impressions, spend, and date range.
7. **Lead retrieval:** independently create one lead with Meta's Lead Ads Testing Tool only
   after callback and Page/Form isolation are verified. Use Webhooks and Source Intake to show
   the signed callback and real `leadgen_id` retrieval. Keep routing and delivery off.

For an approved first-time Page subscription only:

1. Obtain explicit operator authorization.
2. Reconfirm the selected Page ID and existing subscribed-app readback.
3. Set `SA360_META_REVIEW_WRITES_ENABLED=true` on the staging API only and restart it.
   The API still rejects the write if any intake, Graph-fetch, routing, or legacy direct-intake
   flag is active.
4. Check the confirmation box, type `SUBSCRIBE LEADGEN`, and click **Subscribe leadgen** once.
5. The API reads current subscriptions before POSTing. If `leadgen` already exists for
   `META_REVIEW_APP_ID`, it reports “already subscribed” and sends no POST.
6. Set the write flag back to false immediately and re-run readback.

## Permission readiness

| Permission | Ready when | Current implementation posture |
| --- | --- | --- |
| `pages_show_list` | Dedicated Page appears from real `/me/accounts` call with HTTP 200 | Tool implemented; real evidence pending |
| `pages_manage_metadata` | Real subscription readback succeeds; optional approved POST/readback succeeds | Read implemented; write disabled by default |
| `pages_read_engagement` | Real Page-owned post response succeeds | Tool implemented; real evidence pending |
| `ads_read` | Real campaign insight response succeeds for dedicated ad account | Tool implemented; real evidence pending |
| `leads_retrieval` | Real Testing Tool lead reaches signed webhook and Graph retrieval succeeds | Existing path implemented; real evidence pending |

## Recording scripts

Record the browser only. Close developer tools, password managers, hosting dashboards, and token
tools. Pause recording before any environment or Meta token screen.

### Clip 1 — `pages_show_list`

1. Open Admin C.O.C. `/meta-review` and sign in as an admin before recording.
2. Start recording on the preflight and header; show “REAL API RESPONSES ONLY” and masked token
   statuses.
3. In **Connected Pages**, click **Load authorized Pages**.
4. Show the dedicated Page name/ID, Page tasks, sanitized endpoint, HTTP 200, and timestamp.
5. Stop recording without opening developer tools.

### Clip 2 — `pages_manage_metadata`

1. Open `/meta-review`; show the dedicated selected Page.
2. In **Leadgen subscription**, click **Inspect subscribed apps**.
3. Show the real SA360 app row, returned subscribed fields, endpoint, status, and timestamp.
4. If a new subscription was explicitly approved, separately show the enabled write badge,
   check the approval box, type `SUBSCRIBE LEADGEN`, click once, then show the operation result
   and a fresh readback. Otherwise end on the authentic read-only result.

### Clip 3 — `pages_read_engagement`

1. Open `/meta-review`; show the selected dedicated Page.
2. In **Page-owned content**, click **Load Page posts**.
3. Show one real Page-owned post, post ID/time, sanitized endpoint, HTTP 200, and timestamp.
4. Do not navigate to unrelated Page/customer content.

### Clip 4 — `ads_read`

1. Open `/meta-review`; scroll to **Campaign insights**.
2. Select the dedicated allowlisted ad account and a narrow date range.
3. Click **Load campaign insights**.
4. Show real campaign ID/name, impressions, spend, date range, sanitized endpoint, HTTP 200,
   and timestamp.

The separate `leads_retrieval` master recording should show Meta's Testing Tool, the signed
SA360 webhook row, Source Intake Graph success, Page/Form association, and the absence of
routing, inventory, fulfillment, or delivery.

## Reviewer instructions draft

> Sign in to the supplied SA360 Admin C.O.C. test account and open `/meta-review`. The page is
> restricted to our dedicated review Page and ad account. Each permission has a labeled panel.
> Use **Load authorized Pages** for `pages_show_list`, **Inspect subscribed apps** for
> `pages_manage_metadata`, **Load Page posts** for `pages_read_engagement`, and **Load campaign
> insights** for `ads_read`. Each panel displays the versioned Graph endpoint, HTTP status,
> timestamp, and the resulting non-sensitive UI state. Access tokens and app secrets are held
> server-side and never displayed. Page subscription writes are normally disabled and are not
> required to inspect the current subscription.

## Go/no-go

- **Local implementation verification:** GO after tests and builds pass.
- **Staging read-only testing:** GO only after an operator confirms dedicated assets, secret
  storage, exact allowlists, and all intake/routing flags off.
- **Subscription mutation:** NO-GO until separate explicit operator approval.
- **Meta App Review submission:** NO-GO until every mandatory call and recording has authentic
  successful evidence.
