# Agent Workspace — first client embed & agent go / no-go

Use this after **engineering** has deployed production (or staging) API, worker, and admin-coc, and run **read-only** smoke tests successfully (`docs/deploy/agent-workspace-smoke-tests.md`).

**Owners:** one **technical owner** (SA360 / ops) and one **agency owner** (GHL admin). Agents only complete the **Agent go-live** section.

---

## Part A — Technical owner: first real client embed (one-time)

### A1. Preconditions (must all be true)

| # | Check | Owner |
|---|--------|--------|
| 1 | `pnpm smoke:workspace:ps` **read-only** passes against **production** URLs (no `FAIL` lines). | Technical |
| 2 | `SA360_CLIENT_ACCOUNT_ID` and `SA360_GHL_LOCATION_ID` in smoke match **this** client. | Technical |
| 3 | GHL lifecycle workflows already send webhooks to SA360 for this client (or you accept context may be thin until they do). | Agency + technical |

### A2. GHL custom value (required)

| Custom value | Example | Notes |
|--------------|---------|--------|
| `sa360_client_account_id` | *(UUID or id from SA360)* | Must equal SA360 `client_account_id` for this subaccount. |

Create at **location** (or company) scope per your GHL model so `{{custom_values.sa360_client_account_id}}` resolves in menu URLs.

### A3. Custom Menu Links (production admin-coc host)

**General** (no contact in context):

```text
https://<production-admin-coc-domain>/agent-workspace?locationId={{location.id}}&clientAccountId={{custom_values.sa360_client_account_id}}
```

**Contact** (from a contact record):

```text
https://<production-admin-coc-domain>/agent-workspace?locationId={{location.id}}&contactId={{contact.id}}&clientAccountId={{custom_values.sa360_client_account_id}}
```

- Add under the menu where your agents work (e.g. Conversations / Contacts — depends on GHL UI).
- Start with **iframe / embedded** if available.
- If the iframe is blank: open **browser devtools → Console**, capture the error, then try **open in new tab** and file a ticket with the exact message (CSP `frame-ancestors` vs `X-Frame-Options`).

### A4. Validate smoke after embed URLs are known

Re-run read-only smoke with the **same** `clientAccountId` and `locationId` you put in GHL:

```powershell
$env:ALLOW_MUTATING_SMOKE_TESTS = "false"
pnpm smoke:workspace:ps
```

**Go if:** every line is `[PASS]` or optional `[SKIP]`; **no** `[FAIL]`.

**Hold if:** any `[FAIL]` — fix keys, CSP, or edge headers before agents use the link (see `docs/ghl/agent-workspace-gohighlevel-embed.md` §9).

---

## Part B — Agent go / no-go (day of launch)

Give agents this short list. They answer **Yes / No**. Any **No** → stop and ask the technical owner before using the workspace for real work.

### B1. I can open the workspace

| # | Question | Yes | No |
|---|----------|-----|-----|
| 1 | From a **contact**, I can open the SA360 menu item and see the workspace load (not a blank white box). | | |
| 2 | From **general** menu (no contact), the workspace still opens (contact column may be empty — that is OK). | | |
| 3 | I am **not** asked for an internal “admin password” on this link. | | |

### B2. Guidance and actions work for me

| # | Question | Yes | No |
|---|----------|-----|-----|
| 4 | I see **guidance** (scripts / tabs), not an endless spinner. | | |
| 5 | If I submit **“What happened”** with a safe test (e.g. **no answer** on a test contact only), it saves without a scary error. | | |

### B3. I know what to do if something breaks

| # | Question | Yes | No |
|---|----------|-----|-----|
| 6 | I know to **screenshot** the page and **copy any red error text** or console message for support. | | |
| 7 | I know **not** to use **sale / DNC** outcomes on real customers during testing. | | |

---

## Go / no-go decision (agency owner)

| Decision | When |
|----------|------|
| **GO — agents may use the menu** | Part A complete; smoke read-only **PASS**; agent checklist **all Yes** (or only **No** on row 5 if you skipped test submit). |
| **NO-GO — hold agents** | Any smoke **FAIL**; iframe broken with no working **new tab** fallback; workspace asks for admin password; guidance never loads; or **any agent No** on rows 1–4. |

---

## After GO

- Announce the menu location and that **clientAccountId** must stay correct in custom values.
- Technical owner: spot-check **Prisma** / logs for first-day `AgentWorkspaceAction` rows if you enabled “What happened.”
- Optional mutating smoke (dedicated test contact only): `docs/deploy/agent-workspace-smoke-tests.md`.

---

## References

- Embed details, CSP, GHL URLs: `docs/ghl/agent-workspace-gohighlevel-embed.md`
- Smoke automation: `docs/deploy/agent-workspace-smoke-tests.md`
- DigitalOcean layout: `docs/deploy/digitalocean-app-platform.md`
