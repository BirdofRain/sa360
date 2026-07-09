# LF2 Production Migration Runbook

**Purpose:** Apply the four pending Prisma migrations that introduce the LF2 fulfillment shadow schema, align production API code with `master` at `b797eb9`, and restore observability — **without enabling LF2 execution or creating allocations.**

**Status:** Approved in principle. **Do not execute until final authorization from Sam.**

**Constraints during migration window:**

- All `SA360_LF2_*` flags and allowlists remain **disabled**
- Runtime mode remains **`simulate`**
- No LF2 order, allocation, reservation, or canary write
- Stop after schema + deploy verification; do not proceed to canary authorization

---

## Production baseline (read-only audit, 2026-07-09)

| Item | Value |
|------|-------|
| GitHub `master` | `b797eb9d3753ada144856c8e296560eceaf999ff` |
| Production API | `https://sa360-sw6oq.ondigitalocean.app` |
| Deployed commit SHA | **Unknown** — `/health` returns `commitSha: null` |
| Migrations applied | **41 / 45** |
| Pending | `20260601170000_reconcile_client_ghl_destination_option_map`, `20260708180000_fulfillment_shadow_core_v1`, `20260709120000_lf2_reservation_enums_v1`, `20260709121000_lf2_reservation_delivery_attempt_v1` |
| LF2 tables | Absent until migration |
| Legacy `LeadOrder` | 1 row (`LO-1043`, `submitted`) |
| LF2 endpoints today | HTTP **500** (schema mismatch) or **401** without admin key |
| Runtime | `simulate`, no active canary window |

---

## 1. DigitalOcean backup procedure (corrected)

**Do not use manual “Create Backup” snapshot instructions.** DigitalOcean Managed PostgreSQL provides **automatic backups** and **point-in-time restoration (PITR) to a new cluster**. There is **no in-place restore** on the existing cluster.

### Before migration

1. **Confirm newest available restore point**
   - DigitalOcean Control Panel → **Databases** → `sa360-postgres` → **Backups** / **Point-in-time recovery**
   - Note the latest restorable timestamp (UTC)

2. **Record the restore timestamp**
   - Document in the execution log, e.g. `restore_point_utc: 2026-07-09T17:00:00Z`

3. **Confirm account capacity**
   - Verify the DO account can provision a **restored cluster** (additional managed DB instance quota / billing headroom)

4. **Document rebinding requirement**
   - PITR creates a **new cluster** with a **new connection string**
   - Application components (`sa360-api`, `sa360-worker`, any jobs) must update **`DATABASE_URL`** bindings to the restored cluster before traffic cutover
   - Plan DNS/connection cutover; old cluster remains until explicitly destroyed

5. **Optional encrypted logical backup (`pg_dump`)**
   - If production credentials and secure storage (encrypted object store, vault) are available:
   ```bash
   pg_dump "$DATABASE_URL" \
     --format=custom \
     --no-owner \
     --file="sa360-pre-lf2-migration-$(date -u +%Y%m%dT%H%M%SZ).dump"
   ```
   - Encrypt at rest (e.g. age, GPG, or storage-side encryption)
   - Verify restore to disposable Postgres before migration day

### Rollback via database restoration

- Use PITR to a new cluster at the recorded timestamp
- Rebind all App Platform components to the restored cluster
- Redeploy or roll back application revision as needed
- **Not** an in-place rollback on the current cluster

---

## 2. Commit SHA configuration (corrected)

Production `/health` must expose the deployed git revision. Configure the App Platform **component bindable** (not `DO_APP_COMMIT_HASH`).

### API component (`sa360-api`)

```yaml
envs:
  - key: SA360_BUILD_COMMIT_SHA
    scope: RUN_TIME
    value: ${_self.COMMIT_HASH}
```

### Worker (optional, recommended)

```yaml
envs:
  - key: SA360_BUILD_COMMIT_SHA
    scope: RUN_TIME
    value: ${_self.COMMIT_HASH}
```

**Do not use:** `${DO_APP_COMMIT_HASH}` — not a documented App Platform bindable.

**Verification after redeploy:**

```bash
curl -s https://sa360-sw6oq.ondigitalocean.app/health | jq '.commitSha, .buildSource'
# Expect: commitSha == b797eb9d3753ada144856c8e296560eceaf999ff (full hash)
# Expect: buildSource == SA360_BUILD_COMMIT_SHA
```

Code reads this via `apps/api/src/lib/build-version.ts` (`SA360_BUILD_COMMIT_SHA` is first candidate key).

---

## 3. Pre-deploy migration job (preferred)

Wire migrations into App Platform so schema changes run **before** traffic switches and **fail the deployment** on error.

### App spec fragment

```yaml
jobs:
  - name: sa360-migrate
    kind: PRE_DEPLOY
    github:
      repo: BirdofRain/sa360
      branch: master
    source_dir: /
    build_command: >-
      corepack enable &&
      corepack prepare pnpm@10.32.1 --activate &&
      pnpm install --frozen-lockfile
    run_command: pnpm migrate:deploy
    instance_size_slug: basic-xxs
    envs:
      - key: DATABASE_URL
        scope: RUN_TIME
        value: ${sa360-postgres.DATABASE_URL}
```

Replace `${sa360-postgres.DATABASE_URL}` with the **actual database component name** from your app spec.

### Job requirements

| Requirement | How |
|-------------|-----|
| Same Git revision as deployment | Job uses same app deployment source commit |
| Secure DB binding | `${db-component.DATABASE_URL}` — never paste raw URL in spec |
| Fail deployment on migration failure | `PRE_DEPLOY` aborts deploy on non-zero exit |
| Run once per deployment | PRE_DEPLOY lifecycle — not a cron |
| Log migration names + exit code | Prisma `migrate deploy` logs applied migrations; capture in deploy logs |
| Never enable LF2 flags | Job env: **only** `DATABASE_URL` (+ build tooling). **No** `SA360_LF2_*` vars |

### Sequencing risk — first migration

**Adding this job to the App Platform spec and saving it will trigger a new deployment** unless deployments are paused. PRE_DEPLOY jobs do not run standalone; they run as part of a deployment attempt.

| Risk | Mitigation |
|------|------------|
| Spec save auto-deploys before operator ready | **Pause auto-deploy** on the app before saving spec changes |
| Migration runs against prod before preflight complete | Complete execution steps **1–6** before the intentional deploy |
| Job added mid-window causes surprise deploy | Batch spec changes (job + commit SHA) into **one** authorized deploy |

### Controlled one-time alternative (first migration only)

If adding the PRE_DEPLOY job to spec cannot be done without unacceptable sequencing:

1. **Pause auto-deploy**
2. In App Platform → **Console** on a running component (or a **temporary Job** component) with production `DATABASE_URL` binding:
   ```bash
   corepack enable && corepack prepare pnpm@10.32.1 --activate
   pnpm install --frozen-lockfile
   pnpm migrate:deploy
   echo "exit_code=$?"
   ```
3. Verify `prisma migrate status` → 45/45
4. Add PRE_DEPLOY job to spec on the **next** intentional deploy so future migrations are gated

**Not preferred:** unmanaged local shell against production `DATABASE_URL`.

---

## 4. Rollback compatibility (disposable PostgreSQL evidence)

Tested locally against `sa360_prod_rehearsal` (Docker Postgres): full 45-migration chain applied, legacy `LeadOrder` seeded to match production shape.

### Test matrix

| Revision | Relationship | Build | Legacy reads | Targeted tests | Notes |
|----------|--------------|-------|--------------|----------------|-------|
| `491e30d` | Immediately before PR #31 (`b797eb9`) | Pass | `LO-1043` intact; LF2 tables empty | **7/7** pass | Fulfillment execution routes present; GHL canary gate module absent (expected) |
| `be19caa` | Pre-LF2 shadow core (PR #27) | Pass | `LO-1043` intact | **6/6** pass | LF2 Prisma models absent; `LeadAllocation` table exists in DB (0 rows); fulfillment execution routes absent |

### Rollback decision tree (evidence-based)

```
Migration applied (45/45) → need to roll back application code?
│
├─ Roll back to 491e30d (one commit before current master)
│  ├─ Disposable test: PASS (build, legacy reads, 7/7 tests)
│  ├─ LF2 tables/columns remain in DB; production has 0 LF2 rows
│  ├─ GHL canary routes in b797eb9 would be lost (acceptable if canary not started)
│  └─ Outcome: code-only rollback MAY be viable — NOT proven for all endpoints
│
├─ Roll back to be19caa or earlier (pre-shadow-core code)
│  ├─ Disposable test: PASS for legacy lead-order paths (6/6 tests)
│  ├─ Extra LF2 tables/columns remain unused by old Prisma client
│  └─ Outcome: legacy paths work in test; wider endpoint surface untested — higher uncertainty
│
└─ Need schema reverted (drop LF2 tables/columns)?
   └─ Requires PITR to new cluster OR forward migration — NOT code rollback alone
```

**Recorded compatibility result:** Disposable testing supports **application rollback without database restoration for legacy lead-order and admin read paths** at `491e30d`, with **residual risk** on untested routes and any future LF2 row creation. **Neither “definitely safe” nor “definitely requires DB restore”** — scope rollback to tested revisions and re-verify health after rollback.

---

## 5. Final execution sequence

Execute in order. **Stop at step 14** and await canary authorization.

| Step | Action | Pass criteria |
|------|--------|---------------|
| **1** | Verify all LF2 flags and allowlists disabled | No `SA360_LF2_EXECUTION_ENABLED`, `SA360_LF2_GHL_CANARY_ENABLED`, or allowlist env vars enabled |
| **2** | Verify runtime mode `simulate`, no active window | `canRunLiveCanary: false`, `liveCanaryEnabledUntil: null` |
| **3** | Verify latest DigitalOcean restore point | Newest PITR timestamp recorded |
| **4** | Optionally create and verify encrypted `pg_dump` | Dump file encrypted, restore tested to disposable DB |
| **5** | Record migration state | **41 applied / 4 pending** (re-run read-only audit) |
| **6** | Confirm no failed migrations or lock pressure | No unfinished `_prisma_migrations`; connection count normal |
| **7** | Run approved deployment migration job | PRE_DEPLOY `pnpm migrate:deploy` exits 0; logs show 4 migration names |
| **8** | Confirm **45/45** migrations | `prisma migrate status` on production (read-only check via job logs or audit script) |
| **9** | Verify legacy data unchanged, LF2 tables empty | `LO-1043` unchanged; 0 rows in `LeadAllocation`, `DeliveryInstruction`, etc. |
| **10** | Configure `SA360_BUILD_COMMIT_SHA=${_self.COMMIT_HASH}` | API (+ optional worker), scope `RUN_TIME` |
| **11** | Deploy API from `master` at `b797eb9` | Deploy succeeds; PRE_DEPLOY already applied or included in same deploy |
| **12** | Verify health SHA + LF2 read endpoints | `/health` shows `b797eb9…`; LF2 reads return **404** not **500** for nonexistent IDs |
| **13** | Confirm execution remains disabled | LF2 flags off; runtime still `simulate` |
| **14** | **Stop** | Do not create LF2 order or allocation |

---

## 6. Abort conditions

Stop and escalate if any occur:

- Pending migration count ≠ 4 or unexpected migration names
- Failed or unfinished `_prisma_migrations` row
- `migrate deploy` non-zero exit
- Legacy `LeadOrder` row changed or deleted
- Any row inserted into LF2 tables during migration window
- `/health` still shows `commitSha: null` after step 11
- LF2 read endpoints return **500** after step 11 (schema still mismatched)
- Any LF2 execution flag enabled
- Database lock / connection exhaustion during migration

---

## 7. Post-migration (out of scope for this authorization)

After steps 1–14 pass:

- Re-run LF2 first-canary read-only candidate selection
- Separate authorization required before any allocation or canary write

---

## References

- [DigitalOcean App Platform deploy](../deploy/digitalocean-app-platform.md)
- [ADR: LF2 GHL canary v1](../adr/lf2-fulfillment-ghl-canary-v1.md)
- [ADR: ClientGhlDestination reconcile migration](../adr/migration-client-ghl-destination-ordering.md)
- Read-only audit script: `scripts/production-db-audit.readonly.mjs`
- Local migration chain validation: `scripts/validate-migration-chain.ps1`
