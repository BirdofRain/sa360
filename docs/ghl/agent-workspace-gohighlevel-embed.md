# GoHighLevel — SA360 Agent Workspace (embed + linking)

This document matches the **current repo** (`apps/admin-coc`, `apps/api`). Paths, query params, and env names are exact as implemented.

**First client + agent launch:** operator checklist and go / no-go for agents — `docs/ghl/agent-workspace-agent-go-no-go-launch.md`.

**First real GHL embed (URLs + menu + tests):** `docs/ghl/agent-workspace-first-ghl-embed-checklist.md`.

---

## 1. Agent Workspace route (Next.js)

| Item | Value |
|------|--------|
| **Path** | `/agent-workspace` |
| **App** | `apps/admin-coc` — `src/app/agent-workspace/page.tsx` |
| **Full URL** | `https://<admin-coc-host>/agent-workspace?...` |

There is **no** separate Next route for “lead queue UI”; lead queue is API-only: `GET /agent-workspace/v1/lead-queue` on Fastify.

---

## 2. Supported URL query parameters (embed)

Read by `page.tsx` → passed to `AgentWorkspaceApp` → `buildQuery()` for `/api/agent-workspace/context` and `/api/agent-workspace/guidance`.

| Query param | Required | Maps to API (proxy) | Notes |
|-------------|----------|---------------------|--------|
| `clientAccountId` | **Yes** | Same name | Tenant key; must match SA360 `ClientConfig.clientAccountId` / ingest. |
| `locationId` | Optional | `locationId` (API resolves `subaccountIdGhl`) | GHL location id. |
| `contactId` | Optional | **`contactIdGhl`** in query string to API | GHL contact id. |
| `leadUid` | Optional | `leadUid` | SA360 lead UID when known. |
| `nicheKey` | Optional | `nicheKey` | Overrides index-derived niche for guidance. |
| `lifecycleStage` | Optional | `lifecycleStage` | Overrides context-derived stage for guidance. |

**Not** passed from the page today: raw `subaccountIdGhl` (use `locationId` instead; API treats GHL `locationId` as subaccount when resolving workspace scope).

**Load order:** Context is fetched first; guidance is fetched second with `nicheKey` / `lifecycleStage` from **URL** if present, else from **context** (`inboundContactIndex.leadType`, lifecycle stage from index or `lifecycle` object).

---

## 3. Next.js proxy (`admin-coc`)

Browser calls **same-origin** routes (no direct browser → Fastify for workspace):

| Route | Upstream |
|-------|----------|
| `GET /api/agent-workspace/context` | `GET {NEXT_PUBLIC_SA360_API_BASE_URL}/agent-workspace/v1/context?...` |
| `GET /api/agent-workspace/guidance` | `GET .../agent-workspace/v1/guidance?...` |
| `POST /api/agent-workspace/actions/what-happened` | `POST .../agent-workspace/v1/actions/what-happened` |
| `POST /api/agent-workspace/actions/contact-guidance-event` | `POST .../actions/contact-guidance-event` |

**Server env (admin-coc)** — see `src/lib/agent-workspace-api/config.ts` and `src/lib/sa360-public-api-base-url.ts`:

| Variable | Role |
|----------|------|
| `NEXT_PUBLIC_SA360_API_BASE_URL` | Preferred public Fastify base URL (no trailing slash). |
| `NEXT_PUBLIC_API_BASE_URL` | Legacy fallback if the above is unset. |
| `SA360_AGENT_WORKSPACE_API_KEY` or `AGENT_WORKSPACE_API_KEY` | Server-only; sent as **`x-sa360-workspace-key`** to Fastify. **Must equal** API `AGENT_WORKSPACE_API_KEY` or `SA360_WORKSPACE_SECRET`. |

**Admin dashboard** (not required for iframe embed of `/agent-workspace`):

| Variable | Role |
|----------|------|
| `SA360_ADMIN_API_KEY` / `ADMIN_API_KEY` / `SA360_ADMIN_KEY` | Proxies `/admin/v1` from dashboard pages. |
| `ADMIN_COC_PASSWORD` | Gates `/(dashboard)` etc.; **middleware skips** `/agent-workspace` and `/api/agent-workspace/*`. |

---

## 4. Fastify workspace auth

| Header | Value |
|--------|--------|
| `x-sa360-workspace-key` | Non-empty secret matching API env |

Set on API: `AGENT_WORKSPACE_API_KEY` or `SA360_WORKSPACE_SECRET` (`apps/api/src/lib/workspace-auth.ts`).

---

## 5. GHL Custom Menu Link — exact URL formats

Replace `<admin-coc-domain>` with your production admin-coc host (no path).

GHL merge syntax varies slightly by UI version; below uses common `{{...}}` patterns. Use **Location** custom values for agency-wide URLs; **Contact** custom values only where the merge is valid on a contact screen.

### A) Contact-specific (recommended from Contact record / contact-aware menu)

```
https://<admin-coc-domain>/agent-workspace?locationId={{location.id}}&contactId={{contact.id}}&clientAccountId={{custom_values.sa360_client_account_id}}
```

Optional guidance overrides (if you store niche on the contact / custom value):

```
https://<admin-coc-domain>/agent-workspace?locationId={{location.id}}&contactId={{contact.id}}&clientAccountId={{custom_values.sa360_client_account_id}}&nicheKey={{contact.custom_field.sa360_niche_key}}&lifecycleStage={{contact.custom_field.sa360_lifecycle_stage}}
```

(Adjust `contact.custom_field.*` to match **your** GHL custom field merge syntax.)

### B) General / no contact context (sidebar)

```
https://<admin-coc-domain>/agent-workspace?locationId={{location.id}}&clientAccountId={{custom_values.sa360_client_account_id}}
```

Without `contactId`, context/guidance still load for the **client account**; contact-scoped panels depend on API returning partial context (expect sparser lead panel).

### C) Staging / debug (static)

```
https://<staging-admin-coc-host>/agent-workspace?locationId=LOC_ID&contactId=CONTACT_ID&clientAccountId=CLIENT_ACCOUNT_ID&nicheKey=FEX&lifecycleStage=ATTEMPTING_CONTACT
```

Use real ids from staging DB.

---

## 6. GHL Custom Values (recommended)

Custom **values** are for **menu URLs and operator runbooks**. Only names you actually reference in menu links / docs need to exist.

| Suggested name | Example | Where used | Scope |
|------------------|---------|--------------|--------|
| `sa360_client_account_id` | `acme_prod` | Menu link query `clientAccountId` | **Per client / per snapshot** (if multi-tenant GHL) or location-level if one SA360 tenant per location. |
| `sa360_app_base_url` | `https://coc.example.com` | Runbooks; optional base to build links manually | Location or agency |
| `sa360_api_base_url` | `https://api.example.com` | **Not read by Next embed**; useful for webhook setup docs / Postman | Agency |
| `sa360_webhook_url` | `https://api.example.com/webhooks/ghl/lifecycle-event` | GHL **Outbound Webhook** action target | Agency |
| `sa360_webhook_secret` | (long random) | Must match API `WEBHOOK_SECRET`; header `x-sa360-secret` | **Secret** — store in GHL only if your workflow UI supports secrets; otherwise use GHL secrets / env on sending side |

**Not** a GHL custom value: `NEXT_PUBLIC_SA360_API_BASE_URL` — that is **DigitalOcean / Next build env**, not GHL.

---

## 7. GHL Contact Custom Fields — what the repo actually uses

### 7a) “What Happened” → GHL sync (optional)

When `AGENT_WORKSPACE_GHL_SYNC_ENABLED=true` and `GHL_SA360_CUSTOM_FIELD_IDS_JSON` maps keys → GHL field UUIDs, sync updates these **logical keys** (`apps/api/src/services/ghl-sync.service.ts` — `SA360_GHL_CUSTOM_FIELD_KEYS`):

| Field key (logical) | Purpose |
|---------------------|---------|
| `sa360_lifecycle_stage` | Lifecycle string (or defaults e.g. “Appointment Set” on `appointment_set`). |
| `sa360_agent_disposition` | Outcome / disposition string. |
| `sa360_appointment_status` | From metadata or defaults. |
| `sa360_policy_status` | From metadata or defaults. |
| `sa360_last_outcome_at` | ISO timestamp. |
| `sa360_last_outcome_by` | Agent label from metadata or default. |

**Also:** tags (`SA360::EVENT::*`, `SA360::STATUS::*`) and a **note** (`SA360 — <outcome>`) per `buildWhatHappenedGhlPlan`. No pipeline move in code.

### 7b) Lifecycle **webhook payload** (ingest into SA360)

`packages/shared` `LifecycleWebhookPayload` uses **snake_case** in JSON (not GHL custom field ids). GHL workflows must POST a body that validates SA360’s schema; common paths include:

- `contact.lead_uid`, `contact.contact_id_ghl`, names, phone, email, address…
- `state.lead_type`, `state.lifecycle_stage`, `state.appointment_status`, `state.agent_disposition`, `state.policy_status`, `state.routing_status`, …
- `ownership.assigned_agent_id`, `ownership.assigned_agent_name`
- `attribution.*` (campaign, utm, etc.)

**Aligning GHL custom fields to the embed:** the **Agent Workspace UI** does not read GHL custom fields directly; it reads **SA360 context** built from DB (index + lifecycle). So GHL fields like `sa360_niche_key` are **only useful** if your **webhook / integration** copies them into the lifecycle payload (`state.lead_type` / similar) or into SA360’s index another way.

**Do not assume** the long list in your prompt (e.g. `sa360_campaign_id`) is required by the embed — they are **optional payload fields** for richer ingest when your publisher sends them.

---

## 8. GHL workflows → SA360 lifecycle webhook

| Item | Detail |
|------|--------|
| **HTTP route** | `POST https://<api-domain>/webhooks/ghl/lifecycle-event` |
| **Header** | `x-sa360-secret: <WEBHOOK_SECRET>` (must match API env; fail-closed in `apps/api/src/lib/auth.ts`) |
| **Body** | JSON matching `LifecycleWebhookPayload` (`schema_version`, `client_account_id`, `contact`, `attribution`, `state`, `event`, …). |
| **Content-Type** | `application/json` |

**Workflow naming (examples):**

| Workflow trigger (GHL) | Suggested name | Purpose |
|------------------------|----------------|---------|
| New lead / contact created | `SA360 — lifecycle: lead_created` | `event_name_internal: lead_created` |
| First outbound / inbound touch | `SA360 — lifecycle: first_response` | `first_response` |
| Appointment booked | `SA360 — lifecycle: appointment_set` | `appointment_set` |
| Appointment completed | `SA360 — lifecycle: appointment_showed` | `appointment_showed` |
| Sale | `SA360 — lifecycle: sale_logged` | `sale_logged` |
| Mark bad / DNC | `SA360 — lifecycle: contact_updated` | Map to payload + `dead_lead_flag` / disposition as you design |

**Minimal expectation:** every POST includes stable `client_account_id`, `contact.lead_uid`, unique `event.event_uuid`, and `event.event_name_internal` from the shared `InternalEventName` union where possible so SA360 can dedupe and index.

---

## 9. Iframe vs new tab (CSP `frame-ancestors`)

| Topic | Finding |
|-------|---------|
| **Admin password** | `middleware.ts` allows `/agent-workspace` and `/api/agent-workspace/*` **without** `ADMIN_COC_PASSWORD` cookie. |
| **Iframe headers (HTML only)** | For **`GET /agent-workspace`** (and nested paths under that route), **admin-coc** middleware sets **`Content-Security-Policy`** with a **`frame-ancestors`** allowlist. **`/api/agent-workspace/*`** is **not** given this header (JSON proxy responses are not framed as documents). The rest of the dashboard is **not** meant to be embeddable. |
| **`X-Frame-Options`** | The workspace route does **not** rely on `X-Frame-Options: DENY` / `SAMEORIGIN` (those block typical GHL parent frames). Framing is controlled with CSP **`frame-ancestors`** only on `/agent-workspace`. |
| **CORS** | Embed uses **Next same-origin** `/api/agent-workspace/*`; the browser does not call Fastify directly for workspace. Fastify `CORS_ALLOWED_ORIGINS` is irrelevant for that path unless you add client-side API calls later. |
| **GHL menu** | Custom Menu Link can open in iframe or new tab per GHL UI; contact merges work when the menu is attached where `{{contact.id}}` is defined. |
| **Recommendation** | Prefer **iframe** for in-app workflow when CSP allows the GHL parent origin; use **new tab** if a **CDN or reverse proxy** injects `X-Frame-Options` / a conflicting CSP above Next (see §9d). |

### 9a) `GHL_EMBED_FRAME_ANCESTORS` (admin-coc)

| Item | Detail |
|------|--------|
| **Where** | **admin-coc** only (`apps/admin-coc`). Read at **request time** in middleware. |
| **Purpose** | Supply the **source list** for CSP `frame-ancestors` so only approved GHL / white-label hosts can embed `/agent-workspace`. |
| **Unset (default)** | Middleware uses: `frame-ancestors 'self' https://app.gohighlevel.com https://app.leadconnectorhq.com` — **no** `*.gohighlevel.com` wildcard in the default (tight baseline). |
| **Set (recommended prod)** | Either a **source list** (middleware prefixes `frame-ancestors `) or a **full directive** string starting with `frame-ancestors`. |

**Example — staging** (same hosts as default; explicit for clarity):

```text
'self' https://app.gohighlevel.com https://app.leadconnectorhq.com
```

**Example — production with a white-label app host** (replace with your real hostname from the browser address bar when agents open GHL):

```text
'self' https://app.gohighlevel.com https://app.leadconnectorhq.com https://app.youragencydomain.com
```

**Example — full directive passthrough** (use when you want to paste the exact CSP token verbatim):

```text
frame-ancestors 'self' https://app.gohighlevel.com https://app.leadconnectorhq.com
```

Avoid **`frame-ancestors *`** unless you fully accept any site framing the workspace. Prefer **exact HTTPS origins** (and `'self'` for same-origin tooling). Subdomain wildcards like `https://*.gohighlevel.com` are only valid in CSP2+ for `frame-ancestors`; use them only if your GHL deployment **actually** loads the parent from a hostname that does not match the default list.

### 9b) How to verify framing is allowed / blocked

1. Deploy admin-coc with the env var set as needed.
2. Fetch **only the document** route (not the API):

   ```powershell
   $u = "https://<admin-coc-origin>/agent-workspace"
   (Invoke-WebRequest -Uri $u -Method Head -MaximumRedirection 0).Headers["Content-Security-Policy"]
   ```

   You should see a `Content-Security-Policy` value containing `frame-ancestors` and your GHL parent origin.

3. In Chrome DevTools → **Network** → select the **document** for `/agent-workspace` → **Response headers** → confirm `Content-Security-Policy` includes `frame-ancestors` with the parent frame’s origin (e.g. `https://app.gohighlevel.com`).

### 9c) Browser console errors when CSP blocks the iframe

- **`Refused to display '<your-admin-coc-url>' in a frame because an ancestor violates the following Content Security Policy directive: "frame-ancestors ..."`** — the **parent page origin** is not listed; add that exact scheme+host (+port if non-default) to `GHL_EMBED_FRAME_ANCESTORS` (or the default list if you omitted the env var).
- **`Refused to frame ... because it set 'X-Frame-Options' to 'deny'`** (or `sameorigin`) — something **in front of** Next (CDN, load balancer, App Platform edge) is setting **X-Frame-Options**; that blocks iframes regardless of CSP. Remove or scope that header to routes **other than** `/agent-workspace`, or use **new tab** for the menu link until the edge policy is fixed.

### 9d) “Opens in new tab but not in iframe”

| Symptom | Likely cause |
|---------|----------------|
| New tab OK, iframe blank / error | CSP **`frame-ancestors`** missing the real parent origin, or **X-Frame-Options** / conflicting CSP from a **proxy**. |
| Works on one GHL account but not another | Different **white-label** / **regional** app hostname — add that origin explicitly. |

---

## 10. DigitalOcean env checklist (concise)

### API (`apps/api`)

- `DATABASE_URL`
- `REDIS_URL`
- `WEBHOOK_SECRET`
- `AGENT_WORKSPACE_API_KEY` or `SA360_WORKSPACE_SECRET`
- `ADMIN_API_KEY` or `SA360_ADMIN_KEY`
- `PORT` (platform-injected)
- Optional: `GHL_PRIVATE_INTEGRATION_TOKEN` / `AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN` / `GHL_API_KEY`, `GHL_API_BASE_URL`, `AGENT_WORKSPACE_GHL_SYNC_ENABLED`, `GHL_SA360_CUSTOM_FIELD_IDS_JSON`
- Optional: `CORS_ALLOWED_ORIGINS` (comma-separated)

### admin-coc (`apps/admin-coc`)

- `NEXT_PUBLIC_SA360_API_BASE_URL` (or `NEXT_PUBLIC_API_BASE_URL`)
- `SA360_AGENT_WORKSPACE_API_KEY` or `AGENT_WORKSPACE_API_KEY`
- Optional dashboard: `SA360_ADMIN_API_KEY` / `ADMIN_API_KEY` / `SA360_ADMIN_KEY`, `ADMIN_COC_PASSWORD`
- `GHL_EMBED_FRAME_ANCESTORS` — optional; CSP **`frame-ancestors`** source list (or full `frame-ancestors ...` string) for **`/agent-workspace`** only. See §9.
- `SA360_APP_BASE_URL` — **not read by app code** today; optional for operators documenting the public CoC URL

### Worker

- `DATABASE_URL`, `REDIS_URL`, plus logging vars as already documented in root `README.md`.

---

## 11. Smoke test checklist (pre–GHL cutover)

1. **General menu (B):** Open URL without `contactId` — page loads, no redirect to `/login`.
2. **Contact menu (A):** Open from contact with `contactId` — lead context column populated when index exists.
3. **Context:** Network tab shows `200` on `/api/agent-workspace/context`.
4. **Guidance:** `200` on `/api/agent-workspace/guidance`; Script / Objections / Follow-up tabs show seeded rows after `pnpm seed:guidance`.
5. **What Happened:** Submit — `201` on `.../what-happened`; Prisma `AgentWorkspaceAction` row created.
6. **GHL sync (if enabled):** Contact custom fields / tags / note updated per `ghl-sync.service.ts`.
7. **Iframe:** Open inside GHL iframe — no login wall on `/agent-workspace`; **Response headers** on the document include `Content-Security-Policy` with `frame-ancestors` (see §9).
8. **Dashboard still locked:** Visit `/` or `/clients` — should require admin password when `ADMIN_COC_PASSWORD` is set.

---

## 12. PowerShell — direct Fastify guidance (local)

```powershell
$base = "http://localhost:3000"
$key = $env:AGENT_WORKSPACE_API_KEY
$uri = "$base/agent-workspace/v1/guidance?clientAccountId=YOUR_CLIENT&nicheKey=FEX&lifecycleStage=ATTEMPTING_CONTACT"
Invoke-RestMethod -Uri $uri -Headers @{ "x-sa360-workspace-key" = $key }
```

**Success JSON shape** (top level): `ok`, `clientAccountId`, `subaccountIdGhl`, `scripts`, `referralPrompts`, `policyReviewPrompts`, `policyDeliveryPrompts`, `otherResources`, `objectionPlaybooks`, `clientScriptAssignments`.

---

## 13. Repo / code mismatches (for embed)

| Topic | Status |
|-------|--------|
| Menu uses `contactId` | Matches `page.tsx` / `buildQuery` → API `contactIdGhl`. |
| `subaccountIdGhl` in URL | Not used by Next page; use `locationId`. |
| `SA360_APP_BASE_URL` | Documentation / operator convenience only until code reads it. |
| `X-Frame-Options` / CSP | **`/agent-workspace`:** CSP `frame-ancestors` via middleware + `GHL_EMBED_FRAME_ANCESTORS`. **Edge / CDN** may still inject `X-Frame-Options` — validate on deployed host (§9). |

---

## 14. Suggested next Cursor prompt (if you change code)

> “If a CDN injects `X-Frame-Options` for all routes, add a scoped exception for `/agent-workspace` or document ‘open in new tab’ as the workaround. Optionally read `SA360_APP_BASE_URL` in `agent-workspace/page.tsx` to emit `<link rel="canonical">` for support — no functional change to API.”
