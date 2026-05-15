# First real GoHighLevel embed — SA360 Agent Workspace (operational checklist)

**When to use:** Smoke tests have passed (API + admin-coc + CSP). You are enabling **one** real client subaccount in GoHighLevel (GHL / LeadConnector).

**Known URLs (this environment):**

| Role | URL |
|------|-----|
| **API (Fastify)** | `https://sa360-sw6oq.ondigitalocean.app` |
| **admin-coc (Next — Agent Workspace)** | `https://sa360-api-staging-coo57.ondigitalocean.app` |

**Do not** point menu links at the API host for `/agent-workspace`; use the **admin-coc** URL above.

---

## 1) GHL custom value — `sa360_client_account_id`

### What it is

A **location (or company) custom value** whose merge tag supplies the SA360 tenant id **`client_account_id`** in menu URLs. It must match the value SA360 uses for ingest, guidance scope, and workspace API (`clientAccountId` query param).

### Where to add it (typical GHL / LeadConnector)

UI labels vary by product and permissions. In most setups:

1. Open the **subaccount / location** for the client in GHL.
2. Go to **Settings** (gear) for that location.
3. Find **Custom Values** (sometimes under **Business Profile**, **Custom Fields**, or **Company** settings — search for “Custom Values” in settings search if available).
4. **Add custom value**
   - **Name / key:** `sa360_client_account_id` (use exactly this key so merge tags match the URLs below).
   - **Value:** the SA360 `client_account_id` string (e.g. `lal-test-client` for your test tenant — use the **real** production id for a real client).

**Scope:** Prefer **location** scope so `{{location.id}}` and `{{custom_values.sa360_client_account_id}}` resolve together in the same subaccount.

### How to confirm it resolves in a menu URL

1. After saving the custom value, create a **temporary** Custom Menu Link (see §2) or use GHL’s “preview” / merge-tag helper if your tier provides it.
2. Open the link from inside that **same location** as an agent.
3. In the browser address bar (if the app opens in new tab) or in DevTools → **Network** → first document request for `/agent-workspace`, confirm the resolved query string contains  
   `clientAccountId=<your-expected-id>`  
   and **not** empty, `undefined`, or literal `{{custom_values.sa360_client_account_id}}`.
4. If the literal merge text appears in the URL, the custom value name does not match or the menu is attached where custom values are not in scope.

---

## 2) GHL Custom Menu Link setup (two links)

Use **Custom Menu Links** (or **Custom menus** / **Custom links** — name varies). Attach links where agents spend time: **Conversations** and/or **Contacts** context menus are common.

### Link A — General workspace (no contact)

**URL (copy exactly):**

```text
https://sa360-api-staging-coo57.ondigitalocean.app/agent-workspace?locationId={{location.id}}&clientAccountId={{custom_values.sa360_client_account_id}}
```

| Item | Guidance |
|------|-----------|
| **Recommended menu location** | **Conversations** sidebar or **Contacts** list — anywhere agents can open tools without being on a single contact record. |
| **Open mode** | Prefer **iframe / embedded** first (stay inside GHL). |
| **Fallback** | If the iframe is blank or console shows CSP / X-Frame-Options errors, switch the same URL to **open in new tab** and document the exact console message for support. |
| **What the agent clicks** | The new menu item label you choose (e.g. “SA360 Workspace”). |
| **What admin verifies (DevTools)** | **Network:** document request to `/agent-workspace` → **200**, not 307 to `/login`. **Response headers:** `Content-Security-Policy` includes `frame-ancestors`. **Console:** no “Refused to frame” / “X-Frame-Options” errors. |

### Link B — Contact-specific workspace

**URL (copy exactly):**

```text
https://sa360-api-staging-coo57.ondigitalocean.app/agent-workspace?locationId={{location.id}}&contactId={{contact.id}}&clientAccountId={{custom_values.sa360_client_account_id}}
```

| Item | Guidance |
|------|-----------|
| **Recommended menu location** | **Contact record** context (detail view) — menu that appears when viewing **one** contact so `{{contact.id}}` is defined. |
| **Open mode** | **Iframe / embedded** first; same fallback as Link A. |
| **What the agent clicks** | Menu item on a contact (e.g. “SA360 for this contact”). |
| **What admin verifies** | Same as Link A, plus **Network** calls to same-origin `/api/agent-workspace/context` (and guidance) return **200** when keys are configured; **401** means proxy/API key mismatch on admin-coc. |

---

## 3) First client test plan

### Test A — General workspace

| Step | Action | Pass criteria |
|------|--------|----------------|
| A1 | From GHL, open **Link A** from the sidebar/menu (not on a specific contact if possible). | Page loads; not a blank iframe. |
| A2 | Look for **guidance** (scripts / tabs / panels). | Guidance visible; no endless spinner. |
| A3 | Confirm you are **not** asked for the internal **admin-coc password** (cookie gate). | No login wall on `/agent-workspace`. |
| A4 | If embedded, confirm the frame has usable height/scroll. | Not a zero-height iframe (GHL layout issue — adjust menu type or use new tab). |

### Test B — Contact-specific workspace

| Step | Action | Pass criteria |
|------|--------|----------------|
| B1 | Open a **known test contact** in GHL. | Contact id is known for later DB checks if needed. |
| B2 | Open **Link B** from the contact menu. | Workspace loads. |
| B3 | Check URL or DevTools query string. | `contactId` present and matches GHL contact. |
| B4 | **Context** column / panel. | Either real SA360 context (index + lifecycle) **or** clear empty state — **no** hard crash / white screen. |
| B5 | **Guidance** | Still loads (same as Test A). |

---

## 4) Safe mutating test plan (do **not** run until explicitly approved)

**Preconditions:** Dedicated **test** GHL contact only; not production customers.

| Step | Action | Verification |
|------|--------|----------------|
| M1 | In the embedded workspace, submit **What Happened** with outcome **`no_answer`** (and minimal notes). | UI shows success or non-destructive error message. |
| M2 | In DB (Prisma Studio / SQL), find **`AgentWorkspaceAction`** for that `clientAccountId` / contact / time window. | Row exists. |
| M3 | If **`AGENT_WORKSPACE_GHL_SYNC_ENABLED`** and field map are on, check **only the test contact** in GHL for note/tags/fields. | Updates appear as designed; no blast to unrelated contacts. |
| M4 | **Do not** use outcomes **`sale_logged`**, **`not_interested`**, **`wrong_number`**, or other destructive labels on real leads during rollout. | N/A |

---

## 5) Agent go / no-go checklist

Agent: circle **Yes** or **No**. Any **No** → tell admin before wide rollout.

| # | Question | Yes | No |
|---|----------|-----|-----|
| 1 | Can I open SA360 from GHL (general menu)? | | |
| 2 | Can I open it from a **contact**? | | |
| 3 | Do **scripts** (or script tab) show up? | | |
| 4 | Do **objections** show up? | | |
| 5 | Does the page **fit** inside GHL (readable, scrollable)? | | |
| 6 | Is anything **confusing or broken**? | | |
| 7 | **Would I use this while talking to a lead?** | | |

**Go for agents:** Rows 1–5 **Yes**, row 6 **No**, row 7 **Yes** (or row 6 **Yes** with a trivial cosmetic issue logged).

---

## 6) Owner / admin go / no-go checklist

| # | Check | Pass |
|---|--------|------|
| 1 | **Iframe** works, or **new tab** fallback is acceptable and documented. | |
| 2 | **Dashboard** is not exposed: `/clients` (or `/`) still requires admin password when unauthenticated (spot-check in a private window). | |
| 3 | **Guidance** visible for the client’s `clientAccountId`. | |
| 4 | **`clientAccountId`** in URLs matches the intended client only. | |
| 5 | **No cross-client data** in UI when switching contacts / locations (smoke with two test contacts if high risk). | |
| 6 | **No destructive** What Happened / sync tests on real contacts during pilot. | |
| 7 | **Support path** clear (who to ping, what screenshot/console to capture). | |

**Go for org:** All rows checked.

---

## 7) Rollback plan

| Situation | Action |
|-----------|--------|
| Wrong client or bad UX | **Disable or delete** the Custom Menu Link(s) in GHL. |
| Iframe broken | Switch link to **new tab**; fix CSP / edge `X-Frame-Options` later (`docs/ghl/agent-workspace-gohighlevel-embed.md` §9). |
| Key exposure | **Rotate** API `AGENT_WORKSPACE_API_KEY` / `SA360_WORKSPACE_SECRET` and admin-coc workspace key together; redeploy. |
| GHL sync misbehaves | Set **`AGENT_WORKSPACE_GHL_SYNC_ENABLED=false`** (or remove field map) on API; redeploy API. |
| Lifecycle webhooks | **Do not** change `WEBHOOK_SECRET` or webhook URL unless lifecycle is independently failing. |

---

## 8) Final launch decision criteria

| Decision | Criteria |
|----------|----------|
| **LAUNCH — enable for all agents** | Smoke **PASS** on production URLs; §3 Tests A & B **PASS**; §5 agent **Go**; §6 owner **Go**; rollback owner identified. |
| **PILOT — limited agents only** | Iframe OK; one **No** on agent checklist with workaround; monitor for 24–48h. |
| **HOLD — do not widen** | Any smoke **FAIL**; login wall on workspace; guidance blank; cross-client concern; or unresolved CSP / XFO. |

---

## Related docs

- Full embed reference: `docs/ghl/agent-workspace-gohighlevel-embed.md`
- Smoke automation: `docs/deploy/agent-workspace-smoke-tests.md`
- Earlier go/no-go template (placeholders): `docs/ghl/agent-workspace-agent-go-no-go-launch.md`
