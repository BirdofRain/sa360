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
| `ADMIN_API_KEY` or `SA360_ADMIN_KEY` | API | **Yes** | unset | Existing `x-sa360-admin-key` credential accepted by the Fastify admin API. Configure one alias, not two different values. |
| `NEXT_PUBLIC_SA360_API_BASE_URL` | Admin C.O.C. | No | unset | Existing public origin for the Fastify API. It contains no credential, despite the `NEXT_PUBLIC_` prefix. |
| `SA360_ADMIN_API_KEY` | Admin C.O.C. | **Yes** | unset | Server-only credential attached by Admin C.O.C. to Fastify admin requests. It must exactly match the API component's `ADMIN_API_KEY` or `SA360_ADMIN_KEY` value. Never use a `NEXT_PUBLIC_` name for this key. |
| `ADMIN_COC_PASSWORD` | Admin C.O.C. | **Yes** | unset | Existing restricted reviewer/operator sign-in password. It must be configured outside local development so the route does not use the local fail-open posture. |
| `ADMIN_COC_SESSION_SECRET` | Admin C.O.C. | **Yes** | unset | Existing HMAC secret for signed Admin C.O.C. sessions; minimum 16 characters and distinct from portal/session credentials. |

The Admin C.O.C. API key and the API component admin key are the two ends of the existing
authenticated connection contract: `SA360_ADMIN_API_KEY` on Admin C.O.C. must equal whichever
single API alias is configured (`ADMIN_API_KEY` or `SA360_ADMIN_KEY`). Do not copy Meta tokens
into Admin C.O.C.; all Meta credentials stay on the API component.

## Two separate operating phases

These phases are not interchangeable. Phase A collects read-only permission evidence. Phase B
is a later capture-only lead canary with a separate operator authorization gate and temporary
intake activation.

### Phase A — read-only App Review evidence

Use these exact values:

```text
SA360_META_REVIEW_ENABLED=true
SA360_META_REVIEW_WRITES_ENABLED=false
SA360_META_LEAD_ADS_INTAKE_ENABLED=false
SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED=false
SA360_META_LEAD_ADS_ROUTING_ENABLED=false
FACEBOOK_DIRECT_INTAKE_ENABLED=<unset>
```

Phase A permits only allowlisted Graph reads for Page discovery, relevant permission status,
existing Page subscriptions, Page-owned posts, and ad-account insights. It does not retrieve a
real lead, enqueue `meta-leadgen-fetch`, subscribe a Page, or activate intake. A signed webhook
received while intake or Graph fetch is off is retained raw but is not queued for Graph
retrieval. Do not use Phase A as evidence of `leads_retrieval`.

Never set `FACEBOOK_DIRECT_INTAKE_ENABLED=true`: the implementation ORs that legacy alias into
intake, Graph fetch, **and routing**, even when the three explicit flags are false.

### Phase B — separately approved capture-only real lead canary

Phase B is **NO-GO until an operator separately authorizes it after Phase A**. It is not part of
read-only App Review testing. Use these exact values only during the approved canary:

```text
SA360_META_REVIEW_ENABLED=true
SA360_META_REVIEW_WRITES_ENABLED=false
SA360_META_LEAD_ADS_INTAKE_ENABLED=true
SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED=true
SA360_META_LEAD_ADS_ROUTING_ENABLED=false
FACEBOOK_DIRECT_INTAKE_ENABLED=<unset>
SA360_META_LEAD_ADS_FIXTURE_ENABLED=false
```

Before deployment or any flag change, the operator must read back and record the current values
and confirm the implementation's exact behavior:

- intake and Graph fetch must both be true for a live webhook job to call Graph;
- routing false selects `settleMetaLeadCapture`, the capture-only path;
- `FACEBOOK_DIRECT_INTAKE_ENABLED=true` would override the safe posture and enable routing;
- the expected and only new worker activity is one `meta-leadgen-fetch` job for the one
  authorized Testing Tool lead;
- capture-only settlement does not create routing decisions, inventory, fulfillment outbox,
  live delivery, or CAPI dispatch.

Required Phase B preconditions:

1. Correct SA360 Meta app ID/secret, callback verify token, and Page-bound access token are
   present on the API.
2. The dedicated test Page and form are assigned to the app and belong only to the approved
   test/demo client.
3. Callback verification and the existing Page `leadgen` subscription have been read back.
   Creating or changing a subscription remains a separate approved Meta write.
4. The exact Page ID + Form ID association already resolves to the test/demo client.
5. `SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED` is already true and its existing shared behavior has
   been reviewed. If it is false, association is skipped; do not change this shared flag merely
   for the canary—declare NO-GO and obtain another review.
6. Production/live fulfillment, inventory enrollment, routing, GHL delivery, and CAPI remain
   disabled; the operator has read back those controls rather than assuming defaults.
7. Worker-to-API connectivity and the matching existing admin API key are healthy.

Execution is limited to **one** authorized lead from Meta's Lead Ads Testing Tool. Evidence must
show the signed webhook receipt, successful Graph retrieval by `leadgen_id`, normalized Source
Intake capture, correct Page/Form association, and no routing, inventory, fulfillment, GHL, or
CAPI activity. If activation causes any worker activity other than the expected single
`meta-leadgen-fetch` job, or any inventory, routing, fulfillment, or delivery side effect, stop:
Phase B is **NO-GO** and requires another code/operations review before execution.

Immediately after the single lead is settled:

1. Set `SA360_META_LEAD_ADS_INTAKE_ENABLED=false`.
2. Set `SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED=false`.
3. Confirm `SA360_META_LEAD_ADS_ROUTING_ENABLED=false`,
   `FACEBOOK_DIRECT_INTAKE_ENABLED` remains unset, and
   `SA360_META_REVIEW_WRITES_ENABLED=false`.
4. Restart/redeploy only as required by the hosting platform's environment behavior.
5. Reopen `/meta-review` and save a post-rollback preflight readback showing
   `safeForReview=true`.
6. Confirm no `meta-leadgen-fetch` job remains active and no downstream delivery/inventory
   records were created for the canary.

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

## Phase A operator-controlled read-only test plan

Complete these steps in staging with the exact Phase A values above:

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

Stop Phase A here. It must not create a Testing Tool lead or claim successful
`leads_retrieval` evidence. Real lead retrieval belongs only to the separately authorized
Phase B procedure.

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

Only after Phase B receives separate approval, the `leads_retrieval` master recording should
show the one authorized Meta Testing Tool lead, signed SA360 webhook row, Graph success, Source
Intake normalization, Page/Form association, absence of routing/inventory/fulfillment/delivery,
and the immediate post-canary flag rollback readback. Never splice a Phase A read-only clip to
imply that lead retrieval ran while Graph fetch was disabled.

## Reviewer instructions draft

> SA360 uses server-side Meta Business/System User asset provisioning for this initial managed
> integration. An operator assigns the dedicated test Page and ad account to the SA360 Meta app,
> provisions the authorized test credentials, and stores them in the API component's encrypted
> server-side secret store. There is no customer-facing Facebook Login or OAuth connection flow
> in this release. Reviewers cannot authorize Facebook, grant permissions, paste tokens, or
> connect arbitrary assets from within SA360.
>
> Sign in with the supplied restricted SA360 test account and open `/meta-review`. The interface
> is limited to the preconfigured, allowlisted test Page and ad account. Use **Load authorized
> Pages** for `pages_show_list`, **Inspect subscribed apps** for `pages_manage_metadata`, **Load
> Page posts** for `pages_read_engagement`, and **Load campaign insights** for `ads_read`. Each
> panel makes the demonstrated server-to-server Graph call and displays its sanitized versioned
> endpoint, HTTP status, timestamp, and non-sensitive functional result. Tokens and app secrets
> remain server-side and are never displayed. The interface does not simulate success and Page
> subscription writes remain disabled during normal review evidence collection.
>
> A real `leads_retrieval` demonstration, if included, is a separately operator-authorized
> capture-only canary using one Meta Testing Tool lead. It is not initiated from `/meta-review`
> and does not enable routing, inventory, fulfillment, or delivery.

## Go/no-go

- **Local implementation verification:** GO after tests and builds pass.
- **Phase A staging read-only testing:** GO only after an operator confirms dedicated assets,
  secret storage, exact allowlists, signed Admin C.O.C. configuration, matching Admin/API keys,
  and all intake/Graph-fetch/routing flags off.
- **Phase B capture-only canary:** NO-GO until the distinct authorization gate and every Phase B
  precondition are satisfied.
- **Subscription mutation:** NO-GO until separate explicit operator approval.
- **Meta App Review submission:** NO-GO until every mandatory call and recording has authentic
  successful evidence.
