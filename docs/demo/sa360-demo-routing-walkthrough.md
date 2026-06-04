# SA360 demo-safe routing walkthrough (Dylan → Smart Agent 360 Demo)

Shadow-only demo for team meetings. **Do not** enable live delivery, connect live Facebook forms to `sa360_demo`, or change `GHL_DELIVERY_ADAPTER_MODE` away from `simulate`.

## Prerequisites

| Item | Value |
|------|--------|
| Master lead source | `lal_master_vet` |
| Safe destination client | `sa360_demo` (Smart Agent 360 Demo) |
| GHL location (subaccount) | `VPuMIhN6JpxdoXvvlekZ` |
| Lifecycle ingress | `POST /webhooks/ghl/lifecycle-event` |

### Admin C.O.C. env (staging/local)

```bash
NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID=lal_master_vet
```

Rebuild admin-coc after setting `NEXT_PUBLIC_*`.

## 1. Seed demo routing rules (no migrations)

Rules are idempotent JSON seed — not app hardcoding.

```bash
# From repo root (DATABASE_URL required)
ROUTING_RULES_SEED_PATH=./prisma/routing-rules.demo-walkthrough.example.json pnpm exec tsx prisma/seed-routing-rules.ts
```

Optional local override (gitignored):

```bash
cp prisma/routing-rules.demo-walkthrough.example.json prisma/routing-rules.demo-walkthrough.local.json
# edit if needed, then:
ROUTING_RULES_SEED_PATH=./prisma/routing-rules.demo-walkthrough.local.json pnpm exec tsx prisma/seed-routing-rules.ts
```

Verify in Admin C.O.C.:

- **Clients** → `sa360_demo` → routing rules list shows campaign_id + utm_campaign rules.
- **Delivery Readiness** → master `lal_master_vet` (pre-filled) → filter client `sa360_demo`.

## 2. Dry-run a fake lead (Routing Dry Run page)

1. Open **Routing Dry Run** — master should default to `lal_master_vet`.
2. Expand **Test payload** → **Load Dylan demo payload** (generates a unique `event_uuid`).
3. **Run dry run** — expect **Matched** → destination `sa360_demo` / `VPuMIhN6JpxdoXvvlekZ`.
4. **Generate shadow delivery plan** only after validation is not `legacy_unknown` / `unreviewed` and delivery config is complete; otherwise an inline blocked message appears (no page crash).

## 3. Live webhook path (optional, still shadow)

Send a real `lead_created` to the API with Dylan attribution fields and a **new** `event_uuid`. Do **not** use production Bre/demo contact IDs in slides — use test contacts only.

After ingest:

- **Webhook Monitor** → open the stored request.
- **Related Lead Timeline** → `lead_created` row should offer **Open request** when the webhook log shares the same `event_uuid` as the lifecycle row.

## Troubleshooting: page shows “failed to load”

After deploying the malformed-row hotfix, the list should load even if one decision has partial JSON. You do **not** need to delete demo rows.

Optional inspect (staging DB, read-only):

```sql
SELECT id, "sourceLeadUid", "sourceEventUuid", matched, "destinationClientAccountId", "createdAt"
FROM "RoutingDryRunDecision"
WHERE "masterClientAccountId" = 'lal_master_vet'
ORDER BY "createdAt" DESC
LIMIT 10;
```

Reload in Admin C.O.C.: `/routing-dry-run?masterClientAccountId=lal_master_vet` (or use **Reload routing dry-run** on the error page).

## 4. Reversibility

- Set demo rules `active: false` in Admin C.O.C. or remove rows via admin delete (client/rules).
- Re-seed updates existing rows by match identity (no duplicate campaign_id rows for same client).

## Dylan attribution reference (demo)

| Field | Example |
|-------|---------|
| `utm_campaign` | Dylan Diaz- Vet FEX (lead form) 2/18/26 (Andromeda) |
| `campaign_id` | 120241930690720364 |
| `ad_id` | 120241930747440364 |
| `campaign_name` | Master Vet Pixel |
| `meta_dataset_id` | 943556280266263 |
| `source_platform` | facebook |
| `source_type` | facebook_lead_form |
