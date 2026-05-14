# Agent Workspace smoke tests

Repeatable HTTP checks for **staging** and **production** deployments: API health, Fastify guidance, Next `/agent-workspace` (no admin login redirect), CSP / iframe headers, and **optional** mutating tests (lifecycle webhook, “What Happened”) when explicitly enabled.

**Secrets are never committed.** Set environment variables in your shell, CI secret store, or DigitalOcean component env — never paste production keys into the repo.

---

## Purpose

- Run the same checks after every **DigitalOcean** deploy (API, worker, admin-coc).
- Run **read-only** before enabling the **first real GHL Custom Menu Link** for a client.
- Catch misaligned **`x-sa360-workspace-key`**, missing API workspace env, CSP / **X-Frame-Options** issues, and accidental **login redirect** on `/agent-workspace`.

---

## Scripts

| Script | Command |
|--------|---------|
| PowerShell (full) | `pnpm smoke:workspace:ps` |
| Bash (subset) | `pnpm smoke:workspace:bash` |

- **PowerShell** (`scripts/smoke-agent-workspace.ps1`): health, guidance, `/agent-workspace`, CSP checks, protected route, optional lifecycle POST + optional What Happened POST + optional wrong-secret webhook check (401).
- **Bash** (`scripts/smoke-agent-workspace.sh`): health, guidance, `/agent-workspace`, CSP checks, protected route, optional lifecycle POST only. Use PowerShell on Windows for full coverage.

**Neither script runs on** `pnpm install`, `build`, or deploy by default — only when you invoke the `pnpm` script.

---

## Required environment variables

| Variable | Description |
|----------|-------------|
| `SA360_API_BASE_URL` | Public API origin, e.g. `https://sa360-api-staging.example.com` (no trailing slash) |
| `SA360_ADMIN_COC_BASE_URL` | Public Next app origin for admin-coc |
| `SA360_WORKSPACE_KEY` | Same value as API `AGENT_WORKSPACE_API_KEY` or `SA360_WORKSPACE_SECRET` (header `x-sa360-workspace-key`) |
| `SA360_CLIENT_ACCOUNT_ID` | Real or staging `client_account_id` |
| `SA360_GHL_LOCATION_ID` | GHL `locationId` for that subaccount |

---

## Optional environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SA360_GHL_CONTACT_ID` | _(empty)_ | GHL contact id for mutating **What Happened** (PowerShell only) |
| `SA360_LEAD_UID` | _(empty)_ | SA360 `lead_uid` alternative to contact id for What Happened |
| `SA360_NICHE_KEY` | `FEX` | Guidance query |
| `SA360_LIFECYCLE_STAGE` | `ATTEMPTING_CONTACT` | Guidance + lifecycle smoke state |
| `SA360_WEBHOOK_SECRET` | _(empty)_ | Required for mutating lifecycle POST; used only when `ALLOW_MUTATING_SMOKE_TESTS=true` |
| `ALLOW_MUTATING_SMOKE_TESTS` | `false` | Must be `true` / `1` / `yes` / `on` to run POST tests |
| `EXPECTED_FRAME_ANCESTORS` | _(unset)_ | Space-separated tokens that must appear in the `Content-Security-Policy` value for `/agent-workspace` (e.g. white-label host) |
| `SA360_PROTECTED_ROUTE` | `/clients` | Path on admin-coc checked for anonymous access (expect login redirect or 401) |

---

## Safe default behavior

- **`ALLOW_MUTATING_SMOKE_TESTS`** defaults to **false**: no `POST /webhooks/ghl/lifecycle-event`, no `POST .../what-happened`, no DB writes from the smoke scripts.
- Lifecycle mutating payload always sets **`send_to_meta`: `false`** so the worker does not enqueue Meta dispatch for smoke events.
- **What Happened** (PowerShell only, when mutating enabled) uses outcome **`no_answer`** only — never `sale_logged`, `not_interested`, `wrong_number`, or other destructive outcomes in automation.

---

## Enabling mutating tests

1. Use a **dedicated test contact** / test `client_account_id` in production when possible.
2. Set **`ALLOW_MUTATING_SMOKE_TESTS=true`**.
3. Set **`SA360_WEBHOOK_SECRET`** for lifecycle POST; if missing, lifecycle is **skipped** with a warning.
4. For What Happened (PowerShell), set **`SA360_GHL_CONTACT_ID`** and/or **`SA360_LEAD_UID`**; if both missing, that step is **skipped** with a warning.

---

## Why `send_to_meta` must stay `false`

Smoke lifecycle events must **not** enqueue **Meta** dispatch or hit production ads datasets. The API enqueues Meta work when `send_to_meta` is true and related config applies — keep smoke payloads **`send_to_meta: false`** unless you are deliberately running a controlled Meta test (out of scope for these scripts).

---

## Interpreting failures

| Symptom | Likely cause |
|---------|----------------|
| Guidance **401** | `SA360_WORKSPACE_KEY` does not match API `AGENT_WORKSPACE_API_KEY` / `SA360_WORKSPACE_SECRET`. |
| Guidance **503** | Workspace API key not configured on the API service. |
| Guidance **200** but empty guidance | Seed / niche / stage scope; verify `pnpm seed:guidance` against that DB. |
| `/agent-workspace` redirects to **login** | Middleware regression or wrong URL (not admin-coc). |
| CSP **frame-ancestors** missing / wrong | Set `GHL_EMBED_FRAME_ANCESTORS` on admin-coc for white-label GHL hosts; see `docs/ghl/agent-workspace-gohighlevel-embed.md` §9. |
| Browser: **Refused to frame … frame-ancestors** | Parent origin not allowlisted. |
| Browser: **X-Frame-Options DENY/SAMEORIGIN** | CDN / DO edge — fix outside Next or use new-tab menu link temporarily. |
| **`/api/agent-workspace/*` CSP contains `frame-ancestors`** | Unexpected; Next middleware should not add it — check CDN. |
| Protected route **200** without redirect | Confirm behavior with `ADMIN_COC_PASSWORD` (script emits **WARN**). |

---

## After DigitalOcean deploy

1. Confirm new revision is live for **sa360-api**, **sa360-worker**, **sa360-admin-coc**.
2. Export required env vars (from DO or your password manager).
3. Run **read-only** smoke: `ALLOW_MUTATING_SMOKE_TESTS=false` (or unset).
4. Optionally run mutating smoke against **staging** first, then production with a test contact.

---

## Before the first real GHL client menu link

1. Run **read-only** smoke against **production** URLs.
2. Manually open the **iframe** menu link once; confirm console has no CSP / XFO errors.
3. Only then publish the Custom Menu Link to all users.

---

## Example commands

### Staging (PowerShell)

```powershell
cd C:\Users\samue\Source\sa360
$env:SA360_API_BASE_URL = "https://<staging-api-domain>"
$env:SA360_ADMIN_COC_BASE_URL = "https://<staging-admin-coc-domain>"
$env:SA360_WORKSPACE_KEY = "<staging-workspace-key>"
$env:SA360_CLIENT_ACCOUNT_ID = "<staging-client>"
$env:SA360_GHL_LOCATION_ID = "<staging-location>"
$env:SA360_NICHE_KEY = "FEX"
$env:SA360_LIFECYCLE_STAGE = "ATTEMPTING_CONTACT"
$env:ALLOW_MUTATING_SMOKE_TESTS = "false"
pnpm smoke:workspace:ps
```

### Production read-only (PowerShell)

```powershell
cd C:\Users\samue\Source\sa360
$env:SA360_API_BASE_URL = "https://<production-api-domain>"
$env:SA360_ADMIN_COC_BASE_URL = "https://<production-admin-coc-domain>"
$env:SA360_WORKSPACE_KEY = "<production-workspace-key>"
$env:SA360_CLIENT_ACCOUNT_ID = "<real-client-account-id>"
$env:SA360_GHL_LOCATION_ID = "<real-ghl-location-id>"
$env:ALLOW_MUTATING_SMOKE_TESTS = "false"
pnpm smoke:workspace:ps
```

### Production mutating (strong warning)

**Only** with a **dedicated test contact**, explicit approval, and understanding that this **writes** to the production database (and may trigger GHL sync if configured on the API).

```powershell
$env:ALLOW_MUTATING_SMOKE_TESTS = "true"
$env:SA360_WEBHOOK_SECRET = "<WEBHOOK_SECRET>"
$env:SA360_GHL_CONTACT_ID = "<test-contact-id-only>"
pnpm smoke:workspace:ps
```

Lifecycle POSTs always use **`send_to_meta: false`**. What Happened uses **`no_answer`** only.

### Bash (Git Bash / WSL / Linux)

```bash
export SA360_API_BASE_URL="https://<staging-api-domain>"
export SA360_ADMIN_COC_BASE_URL="https://<staging-admin-coc-domain>"
export SA360_WORKSPACE_KEY="<staging-workspace-key>"
export SA360_CLIENT_ACCOUNT_ID="<staging-client>"
export SA360_GHL_LOCATION_ID="<staging-location>"
pnpm smoke:workspace:bash
```

---

## Sample output (illustrative)

```
SA360 Agent Workspace smoke (secrets redacted)
  API base:    https://api.example.com
  ...

[PASS] api:/health — HTTP 200 ok=true
[PASS] api:/health/db — HTTP 200 ok=true
[PASS] api:/health/queue — HTTP 200 ok=true
[PASS] api:guidance — HTTP 200 scripts=12 objectionPlaybooks=4
[PASS] coc:agent-workspace — HTTP 200, not redirected to login
[PASS] csp:agent-workspace — frame-ancestors present in CSP
[PASS] csp:x-frame-options — no X-Frame-Options (OK for iframe)
[PASS] csp:api-proxy-context — no frame-ancestors in CSP (or no CSP header)
[PASS] coc:protected-route — HTTP 307 redirect to login (protected)
[SKIP] mutate:lifecycle-webhook — ALLOW_MUTATING_SMOKE_TESTS is not true
[SKIP] mutate:what-happened — ALLOW_MUTATING_SMOKE_TESTS is not true

Summary: failures=0 skips=2
```

**PASS** = required assertion succeeded. **FAIL** = required assertion failed (script exits `1`). **SKIP** = optional step not run (mutating disabled or missing optional env). **WARN** = manual follow-up (e.g. white-label CSP hint, unexpected HTTP on protected route).

---

## GitHub Actions follow-up

There is **no** `.github/workflows` smoke workflow in this repo yet. A safe addition is a **`workflow_dispatch`** job that:

- Runs only manually.
- Uses a **GitHub Environment** (`staging` / `production`) for secrets (`SA360_WORKSPACE_KEY`, `SA360_WEBHOOK_SECRET`, URLs).
- Sets `ALLOW_MUTATING_SMOKE_TESTS` default **false**.
- Runs `pnpm smoke:workspace:ps` on `windows-latest` or invokes PowerShell Core on `ubuntu-latest`.

Do **not** echo secret values in workflow logs.

---

## Related docs

- DigitalOcean layout: `docs/deploy/digitalocean-app-platform.md`
- GHL embed + CSP: `docs/ghl/agent-workspace-gohighlevel-embed.md`
