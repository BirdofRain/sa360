# Source Intake — SA360 Demo one-row live canary (staging)

Operator runbook to clear **Approve** preflight blockers for **Smart Agent 360 Demo only**.
Does not enable Breanna, real clients, or broad live delivery.

**Canonical demo destination (staging rekey)**

| Field | Value |
|-------|-------|
| Client | `smart_agent_360_demo_2` (env allowlist; legacy constant `smart_agent_360_demo`) |
| GHL location | `VPuMIhN6JpxdoXvvlekZ` |

**Do not merge `source-intake-webhook-routes` for this path.** Bulk import delivery uses
`POST /admin/v1/bulk-imports/internal/process-chunk` and `bulk-import-delivery.service.ts`.
The webhook branch only changes lifecycle webhook handling.

---

## 1. Code paths (preflight readiness)

### Admin UI

| Step | Location |
|------|----------|
| Approve step opens | `apps/admin-coc/src/components/bulk-imports/bulk-import-wizard.tsx` |
| Preflight fetch | `useEffect` when `viewStep === "approve"` → `fetchBulkImportLiveCanaryPreflight()` |
| Server action | `apps/admin-coc/src/app/actions/bulk-imports.ts` → `GET .../live-canary-preflight` |
| Approve disabled logic | `resolveApproveDeliveryReadiness()` + `liveCanaryPreflight.ready` |

### API

| Step | Location |
|------|----------|
| HTTP | `GET /admin/v1/bulk-imports/:id/live-canary-preflight` (`admin-bulk-imports.ts`) |
| Core checks | `runBulkImportLiveCanaryPreflight()` → `bulk-import-live-canary-preflight.service.ts` |
| Runtime mode | `warmEffectiveDeliveryAdapterMode()` → `delivery-runtime-mode.service.ts` + `DeliveryRuntimeModeSetting` |
| Env ceiling | `getGhlDeliveryAdapterMaxMode()` → `ghl-delivery-adapter-mode.ts` |
| Cutover / internal approval | `ClientGhlDestination.clientCutoverApproved`, `.internalApprovalStatus` |
| Worker gate | `SA360_API_INTERNAL_URL` + `ADMIN_API_KEY` on **API** process |
| Queue gate | `redis.ping()` |
| Approve enforcement | `approveBulkImportDelivery()` re-runs same preflight before enqueue |
| Initial canary guard | `validateInitialBulkImportCanary()` → demo-only, wave ≤ 1, `source_tag_only` |
| Live delivery | Worker → `process-chunk` → `deliverBulkImportRow()` → `approveSourceLeadDelivery(live_canary)` |

---

## 2. Configuration controls

### Environment variables

| Variable | Component | Purpose |
|----------|-----------|---------|
| `GHL_DELIVERY_ADAPTER_MAX_MODE=live_canary` | API + Worker | Env **ceiling**; preflight requires `adapterMaxMode === live_canary` |
| `SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS=smart_agent_360_demo_2` | API + Worker | Explicit allowlist (demo only) |
| `SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS=VPuMIhN6JpxdoXvvlekZ` | API + Worker | Explicit allowlist (demo location only) |
| `SA360_API_INTERNAL_URL=https://<api-host>` | **API** (preflight) + **Worker** (dispatch) | Must be valid URL with hostname |
| `ADMIN_API_KEY=<secret>` | **API** (preflight) + **Worker** | Same value as admin-coc `SA360_ADMIN_API_KEY` |
| `REDIS_URL=<redis-url>` | API + Worker | BullMQ queue; preflight pings Redis |
| `SA360_BULK_SOURCE_IMPORTS_ENABLED=true` | API | Bulk import API routes |
| `NEXT_PUBLIC_SA360_BULK_SOURCE_IMPORTS_ENABLED=true` | admin-coc | Bulk import UI |
| `SA360_ADMIN_API_KEY=<secret>` | admin-coc | Proxies admin API calls |
| `SA360_BULK_IMPORT_INITIAL_CANARY_DEMO_ONLY` | API | Default **true** — keep unset or `true`; never `false` on staging canary |

**Not env — DB/runtime toggle**

| Control | Storage | How to set |
|---------|---------|------------|
| Effective runtime `live_canary` | `DeliveryRuntimeModeSetting` | Admin COC → `/direct-delivery-demo` → Enable live canary (15 min) with phrase `ENABLE LIVE CANARY` |
| | | Or `POST /admin/v1/delivery-runtime-mode` |

**Hard-coded (no env override for canary limits)**

| Constant | Value | File |
|----------|-------|------|
| `BULK_IMPORT_INITIAL_CANARY_MAX_ROWS` | `1` | `packages/shared/src/constants.ts` |
| `BULK_IMPORT_INITIAL_CANARY_DEMO_CLIENT_ID` | `smart_agent_360_demo` (fallback) | same |
| `BULK_IMPORT_INITIAL_CANARY_DEMO_LOCATION_ID` | `VPuMIhN6JpxdoXvvlekZ` | same |
| `SA360_BULK_IMPORT_INITIAL_CANARY_DEMO_CLIENT_ID` | optional override | `apps/api/src/lib/bulk-import-demo-canary-config.ts` |
| Single-entry allowlist | auto-resolves demo client id | same (staging uses `_2`) |

**Per-batch (wizard)**

| Field | Requirement |
|-------|-------------|
| `importOptionsJson.workflowStrategy` | `source_tag_only` (default on destination save) |
| Destination | Demo client + location only |
| Wave size | UI max 1; approve API caps at 1 when demo-only guard is on |

### Database / config records (demo client only)

**Preferred:** Source Intake Approve step → **Approve SA360 Demo for Source Intake live canary**
(only shown when env allowlist matches but cutover/internal approval is pending).

**Or** POST admin action:

```http
POST /admin/v1/clients/smart_agent_360_demo_2/approve-source-intake-live-canary
x-sa360-admin-key: <ADMIN_API_KEY>
```

**Or** PATCH **`ClientGhlDestination`** for `smart_agent_360_demo_2` only:

```http
PATCH /admin/v1/clients/smart_agent_360_demo_2/ghl-destination
x-sa360-admin-key: <ADMIN_API_KEY>
Content-Type: application/json

{
  "clientCutoverApproved": true,
  "internalApprovalStatus": "approved"
}
```

If approval was set on legacy `smart_agent_360_demo` only, re-run for `smart_agent_360_demo_2`
(the import batch destination must match the env allowlist client id).

**Do not** set these on Breanna or any real client. **Do not** set `deliveryEnabled: true` or
`deliveryMode: live` unless you intentionally want destination-level live flags (bulk import
preflight does not require them; cutover + internal approval fields are what unblock Approve).

Also ensure demo destination readiness (separate blockers if missing):

- OAuth connected for `VPuMIhN6JpxdoXvvlekZ`
- GHL config discovery saved (custom fields, pipeline, owner as required)
- Cutover readiness panel green for destination section

---

## 3. DigitalOcean staging procedure

### Step A — Env vars (redeploy API + Worker + admin-coc)

Apply on **sa360-api** and **sa360-worker** (shared vars):

```
GHL_DELIVERY_ADAPTER_MAX_MODE=live_canary
SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS=smart_agent_360_demo_2
SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS=VPuMIhN6JpxdoXvvlekZ
SA360_API_INTERNAL_URL=https://<your-staging-api-host>
ADMIN_API_KEY=<staging-admin-key>
REDIS_URL=<staging-redis-url>
SA360_BULK_SOURCE_IMPORTS_ENABLED=true
```

On **sa360-admin-coc**:

```
NEXT_PUBLIC_SA360_BULK_SOURCE_IMPORTS_ENABLED=true
SA360_ADMIN_API_KEY=<same-as-API-ADMIN_API_KEY>
NEXT_PUBLIC_SA360_API_BASE_URL=https://<your-staging-api-host>
```

**Redeploy required** after env changes.

`SA360_API_INTERNAL_URL`: use the staging API public HTTPS base (no trailing slash). Worker calls
`{SA360_API_INTERNAL_URL}/admin/v1/bulk-imports/internal/process-chunk`.

### Step B — Demo client cutover flags (no redeploy)

Use the Approve-step button, POST approve action, or PATCH above for **`smart_agent_360_demo_2`**.
Or use Admin COC delivery-readiness / client delivery-config if those screens expose the same fields.

### Step C — Enable runtime live_canary (no redeploy)

1. Open Admin COC → **Direct Delivery Demo** (`/direct-delivery-demo`).
2. Reason: `Source Intake one-row demo canary — staging`.
3. Type **`ENABLE LIVE CANARY`** → Enable for 15 minutes.
4. Confirm **Effective mode: live_canary**, **Can run live canary: Yes**.

Re-enable before each canary window if expired (auto-reverts to simulate).

### Step D — Import batch setup (operator)

1. Upload CSV → map → **Destination: Smart Agent 360 Demo** / `VPuMIhN6JpxdoXvvlekZ`.
2. Confirm **workflow strategy: source_tag_only** (default).
3. Normalize → Simulate (≥1 row).
4. Open **Approve**.

---

## 4. Verification (Approve page)

Expected after Steps A–C and a simulated demo batch:

| Field | Expected |
|-------|----------|
| Destination client | Smart Agent 360 Demo |
| Workflow strategy | `source_tag_only` |
| Delivery wave size | max **1** |
| **Ready** | Yes |
| **Runtime mode** | `live_canary` |
| **Client cutover** | approved |
| **Internal approval** | approved |
| **Worker configured** | Yes |
| **Queue reachable** | Yes |
| Blockers | (empty) |
| Env allowlisted, cutover pending | Shows: *This client is allowed by env but has not been approved in client cutover readiness.* |
| Approval phrase | Still required: `APPROVE BULK LEAD DELIVERY` |

**API cross-check:**

```bash
curl -s -H "x-sa360-admin-key: $ADMIN_API_KEY" \
  "https://<api>/admin/v1/bulk-imports/<importId>/live-canary-preflight" | jq .
```

Expect `"ready": true`, `"effectiveRuntimeMode": "live_canary"`, `"cutoverApproved": true`,
`"internalApproval": "approved"`, `"workerConfigured": true`.

**Confirm demo-only eligibility:**

- Non-demo destination → initial canary guard blocks approve.
- Wave > 1 → blocked.
- `workflowStrategy` ≠ `source_tag_only` → blocked.
- Env allowlist contains **only** demo client/location.

---

## 5. Approve and monitor (one row)

1. Type **`APPROVE BULK LEAD DELIVERY`**.
2. Keep wave size **1**.
3. Click **Approve delivery wave**.
4. Monitor step: queue job should move to active/completed; one row → `delivered`.
5. Verify in GHL demo subaccount: contact created, source tags only, **no** NEW_LEAD / AI trigger tags.

Do **not** approve a second wave until the first row is verified in GHL.

---

## 6. Rollback

| Action | Effect |
|--------|--------|
| `/direct-delivery-demo` → type **`RETURN TO SIMULATE`** | DB runtime → simulate immediately |
| PATCH demo `ghl-destination` with `clientCutoverApproved: false`, `internalApprovalStatus: not_reviewed` | Clears cutover blockers for demo only |
| Remove demo IDs from `SA360_DIRECT_DELIVERY_ALLOWED_*` (or set `GHL_DELIVERY_ADAPTER_MAX_MODE=simulate`) + redeploy | Hard stop live allowlist |
| `POST .../bulk-imports/:id/pause` | Stops in-flight batch |

Verify: Approve preflight **Ready: No**, runtime **simulate**.

---

## 7. Safety guarantees (unchanged by this runbook)

- Approval phrase **`APPROVE BULK LEAD DELIVERY`** still required.
- Initial canary guard: demo destination only, **1 row**, **`source_tag_only`**.
- No webhook branch merge required for delivery.
- Real clients unchanged if allowlist and DB patches are demo-scoped only.
