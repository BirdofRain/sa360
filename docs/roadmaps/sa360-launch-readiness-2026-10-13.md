# SA360 launch readiness — reconciled 14 October 2026

**Project:** Life Agent Launch / Smart Agent 360
**Repository baseline:** `origin/master` `2e2a9e1ad2d913f0bdabd642ce200b37b0c25512` (PR #179)
**Status filename:** kept as `2026-10-13` because that was the requested roadmap date. The facts below were checked on **14 October 2026** and replace the 13 October assumption that PRs #177–#179 were still open.
**Kanban:** `sa360_beta_mvp_launch` (live board, not the seed file)
**Change log:** [Kanban reconciliation](../validation/sa360-kanban-reconciliation-2026-10-14.md)

Evidence labels used below:

- **Verified** — read from GitHub, the public HTTP endpoints, the active DigitalOcean deployment spec, or the source tree at `2e2a9e1`.
- **User-reported** — supplied in the 13 October reconciliation request and not independently re-proven.
- **Inferred** — a reasonable reading of deployment state that was not confirmed by a direct production data query.

No feature flag, credential, production migration, Meta subscription, customer import, billing event, or lead delivery was changed while writing this document.

## 1. Executive summary

SA360 can already complete an aged spreadsheet order through the normal production path. It is **not** ready for direct Facebook lead capture, a Vanessa historical import, or an unattended buyer launch.

The git revision deployed to the API, worker, migrate job, and Admin C.O.C. is current `master` (`2e2a9e1`). That means merged code through PR #179 is on the running revision. Several of those features are still inactive, and one legacy switch is active in the wrong direction: `FACEBOOK_DIRECT_INTAKE_ENABLED=true` on the API app. In code, that alias turns Meta intake, Graph fetch, and routing on together even though the three explicit flags are `false`.

The customer inventory map flag is already `true` on Admin C.O.C. This audit did not turn it on and did not turn it off. Customer-facing validation is still open.

## 2. Current launch classification

**Controlled aged-CSV beta, with deployed but unaccepted fulfillment code, and an unsafe Meta flag.**

| Gate | Classification |
| --- | --- |
| Aged spreadsheet fulfillment | One production order completed (LO-1055, 85 leads, 6 October 2026). Counters, notifications, and State presentation still disagree with that success. |
| Buyer-ready quality, operator review, receipts (#177–#179) | Merged and present in the deployed revision. Not operationally accepted. Receipt import is off. |
| Vanessa historical suppression | Preparation only. Import is not approved. |
| Inventory map | Code deployed and portal flag already true. Live behavior not re-checked in a customer session. |
| Direct Facebook intake | Not approved. Legacy alias is currently true on the API. |
| Meta App Review videos | Not recorded. Review tooling is only half configured. |
| GHL live delivery | Mode on the API app is `live_canary`. That is not the same as the LO-1055 spreadsheet release. |

## 3. Completed milestones

**Verified**

- Public data-deletion instructions: `https://lifeagentlaunch.com/data-deletion/` returned HTTP 200 on 14 October 2026. The body is the Facebook/Instagram deletion instructions on WordPress page 1188. **User-reported** publication is confirmed for the public URL. Meta dashboard registration of that URL was **not** verified.
- Production API `GET /health` returned `commitSha=2e2a9e1ad2d913f0bdabd642ce200b37b0c25512`, `buildSource=SA360_BUILD_COMMIT_SHA`.
- `GET /health/db` returned connected. `GET /health/queue` returned PONG.
- Admin C.O.C. `GET /api/health` on `https://sa360-api-staging-coo57.ondigitalocean.app` returned `ok`.
- Active DigitalOcean revisions for `sa360-api`, `sa360-worker`, `sa360-migrate`, and the Admin C.O.C. service are all `2e2a9e1`. There was no in-progress deployment.
- These pull requests are merged and are ancestors of that deployed revision: #156, #157, #159, #160, #161, #162, #164–#173, #177, #178, #179.
- LO-1055 completed on 6 October 2026 through selection, export, and spreadsheet release. 85 leads, `externalWriteOccurred=false`, customer notification skipped for a missing portal email. Source: `docs/validation/lo1055-production-completion-2026-10-06.md`.
- API `ENABLE_DEBUG_ROUTES` is `false` on the active spec. `GET /webhooks/ghl/test` returned the application's 404. `/debug/test-event` was not called.

**User-reported and now also verified:** the data-deletion page is published at the expected public URL.

## 4. Verified active development

Nothing in #177, #178, or #179 is still an open feature branch. Those three merged on 13–14 October 2026.

Open work that still matters:

| PR | State on 14 October 2026 | Notes |
| --- | --- | --- |
| #180 | Open draft | Post-#179 validation notes and extra tests. Not merged. Its earlier report that API debug routes were on does not match the active spec checked later the same day. |
| #174 | Open draft | Read-only aggregate PPL inventory audit. |
| #176 | Open draft | UTC age cutoff. Targets the #174 branch, not `master`. |
| #175 | Open draft | Localhost-only Cloud Agent admin key. |
| #158 | Open draft | Earlier inventory-map API. Not closed. Overlaps the portal UI of merged #172 and adds a different API read model. |
| #134, #140, #141, #145, #101–#104, #10 | Still open | Not re-validated against current `master`. Do not merge them as-is. |

Issue #51 is not done: Front Office Inventory Explorer still returns fixtures from `getInventoryExplorerReadModel()`.

## 5. Pending PR, migration, and deployment work

**Verified:** the running git revision matches `master`. Deployment and enablement are different.

**Inferred:** the active `sa360` deployment phase is `ACTIVE` and includes the `sa360-migrate` pre-deploy job at `2e2a9e1`. DigitalOcean does not mark that deployment active when the job fails. That is not a query of `_prisma_migrations`.

Migrations added after the LO-1055 deploy and present in the repo (84 migration directories on `master`):

- `20261013160000` — operator review (#178)
- `20261013170000`, `20261013180000`, `20261013190000` — external delivery receipts (#179)

#177 has no schema change.

Until an operator records those four migration names as applied, buyer fulfillment that reads the receipt table can fail closed. Receipt import must stay off either way.

## 6. Meta review readiness

**Verified code and config. Videos are not done.**

| Piece | State |
| --- | --- |
| Data-deletion page | Public URL live. Dashboard registration unverified. |
| Direct intake foundation | #156 merged and deployed. |
| Review UI and API | #171 merged and deployed. |
| Privileged-access guard | #173 merged and deployed. |
| `SA360_META_REVIEW_ENABLED` | `false` on the API app, `true` on Admin C.O.C. The page and the API do not agree. |
| Review writes | `false` |
| Explicit intake, Graph fetch, routing | `false` on the spec |
| Legacy `FACEBOOK_DIRECT_INTAKE_ENABLED` | **`true` on the active API spec.** Effective intake, Graph fetch, and routing are therefore on. |
| Review allowlists, review user token, Page id binding, review app id | Keys exist and values are empty. |
| `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` | Set on the API app. |
| `META_PAGE_ACCESS_TOKEN` | Duplicate app-level entries: one secret is set, one is empty. Page id binding is empty, so a set token is unbound. |
| Four permission videos | Not recorded. |
| `leads_retrieval` proof | Not recorded. Must stay separate from the read-only videos. |

Do not record videos, subscribe a Page, or run a capture canary until the legacy alias is unset and the explicit routing flag is still false.

`SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED=true` is a separate shared capture flag used by the existing Zapier path. This audit did not change it.

## 7. DigitalOcean environment readiness

Read from the **active deployment specs** on 14 October 2026. Values of secrets are not listed. Boolean flags are classified only as true or false.

Apps:

| App | App id | Public origin | Component names |
| --- | --- | --- | --- |
| `sa360` | `2c381355-37a1-415f-bf06-ad477add164e` | `https://sa360-sw6oq.ondigitalocean.app` | `sa360-api` service, `sa360-worker` worker, `sa360-migrate` job |
| `sa360-admin-coc` | `2075694a-ed30-4e7c-ae59-87b3ebfa9db7` | `https://sa360-api-staging-coo57.ondigitalocean.app` | Service name is `sa360`, not `sa360-COC`. |

`NEXT_PUBLIC_SA360_API_BASE_URL` on Admin C.O.C. is `https://sa360-sw6oq.ondigitalocean.app` with no trailing slash. Worker `SA360_API_INTERNAL_URL` is the same host. API and Admin C.O.C. admin keys were compared and match. `SA360_ADMIN_KEY` is not set; `ADMIN_API_KEY` and `SA360_ADMIN_API_KEY` are the names in use.

| Variable | API app | API service | Worker | Migrate job | Admin C.O.C. app |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` / `REDIS_URL` | set, inherited | inherited | inherited | inherited | set |
| `ADMIN_API_KEY` | set, duplicated | inherited | inherited | inherited | set, matches API |
| `SA360_ADMIN_API_KEY` | set, matches API admin key | inherited | inherited | inherited | set, matches |
| `ADMIN_COC_SESSION_SECRET` / `ADMIN_COC_PASSWORD` | absent | absent | absent | absent | set |
| `SA360_BUILD_COMMIT_SHA` | absent at app level | bindable, RUN_TIME | bindable, RUN_TIME | inherited | absent |
| `ENABLE_DEBUG_ROUTES` | **false** | inherited | inherited | inherited | **true** (Next app; API probe is the one that matters) |
| `META_APP_SECRET` / `META_WEBHOOK_VERIFY_TOKEN` | set | inherited | inherited, not needed | inherited | absent, correct |
| `META_PAGE_ACCESS_TOKEN` | duplicate; one secret set, one empty | inherited | should not need the token | inherited | absent, correct |
| `META_PAGE_ACCESS_TOKEN_PAGE_ID` | empty | inherited | n/a | n/a | absent |
| `META_REVIEW_USER_ACCESS_TOKEN` / `META_REVIEW_APP_ID` | empty | inherited | n/a | n/a | absent |
| `SA360_META_REVIEW_ALLOWED_PAGE_IDS` / `_AD_ACCOUNT_IDS` | empty | inherited | n/a | n/a | absent |
| `SA360_META_REVIEW_ENABLED` | **false** | inherited | n/a | n/a | **true** |
| `SA360_META_REVIEW_WRITES_ENABLED` | **false** | inherited | n/a | n/a | absent |
| `SA360_META_LEAD_ADS_INTAKE_ENABLED` | **false** | inherited | n/a | n/a | absent |
| `SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED` | **false** | inherited | n/a | n/a | absent |
| `SA360_META_LEAD_ADS_ROUTING_ENABLED` | **false** | inherited | n/a | n/a | absent |
| `FACEBOOK_DIRECT_INTAKE_ENABLED` | **true** | inherited | inherited | inherited | absent |
| `SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED` | **true** | inherited | inherited | inherited | absent |
| `SA360_PORTAL_INVENTORY_MAP_ENABLED` | absent, correct | absent | absent | absent | **true** |
| `SA360_PPL_SELECTION_ENABLED` / `SA360_PPL_CSV_EXPORT_ENABLED` | true | also true on the API service | inherited | inherited | absent |
| `SA360_PPL_OPERATOR_REVIEW_ENABLED` | **true** | inherited | inherited | inherited | absent |
| `SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED` | **false** | inherited | inherited | inherited | absent |
| `SA360_PPL_EXTERNAL_RECEIPT_SUPPRESSION_ENABLED` | **true** | inherited | inherited | inherited | absent |
| `SA360_ENV` | `production` | inherited | inherited | inherited | set |
| `GHL_DELIVERY_ADAPTER_MODE` | `live_canary` | inherited | inherited | inherited | not re-listed |

Also duplicated on the API app: `GHL_API_BASE_URL`. `SA360_META_LEAD_ADS_FIXTURE_ENABLED` is absent. The fixture route is forced off when `SA360_ENV` is production.

The local workspace `.env` contains a non-local `DATABASE_URL` and an admin key that matches production. This reconciliation did not query that database. Production URLs do not belong in a developer `.env`.

## 8. Vanessa reconciliation

**User-reported accounting, not re-counted from the workbook:**

| Bucket | Count |
| --- | --- |
| Original historical export | 3,304 rows |
| Previously delivered | 3,260 |
| Rejected or excluded | 44 |

The 3,304 figure is the source export, not 3,304 successful deliveries. The workbook is not in git and was not opened.

**Verified in source, not against Vanessa's file:** receipt apply writes `BuyerExternalDeliveryReceipt` rows only. It does not create `LeadAllocation` or `BuyerDeliveredIdentity`. Grouping is phone **or** email, buyer-scoped. An exact repeat is a duplicate. A row that would join two already-distinct identity groups is `identity_conflict` and is not applied. Connected rows keep the extra phone or email. A rejected-before-delivery row does not create suppression. Transitive shared-email grouping can still treat two phones as one consumer for that buyer; that policy needs confirmation before any import.

Import flag is false. Suppression flag is true. Stages that apply production data are not authorized.

## 9. Inventory map readiness

**Verified:** PR #172 is merged. Admin C.O.C. is deployed at `2e2a9e1`. `SA360_PORTAL_INVENTORY_MAP_ENABLED=true` on the Admin C.O.C. app, which is the server-side place for that flag. It is not a `NEXT_PUBLIC_` variable.

**Not verified:** aggregate performance, state/niche/age matching, exclusion of pending-review / held / unavailable / reserved rows, canonical totals, tenant isolation in a live session, stale-response behavior, or the customer experience. The map's code is advisory. This audit did not exercise `/portal/orders/new` with a customer login.

PR #158 stays open. Closing it would require a reviewer to confirm that #172's leads-on-demand availability path covers #158's API exclusion rules. That confirmation was not made.

Issue #51 remains fixture-backed and is a different surface from the customer map.

## 10. Fulfillment operator readiness

**Verified from the 6 October report and from current code/config:**

- LO-1055, 85 Veteran leads for the recorded buyer, completed through preview, reservation (3,375 ms), export, and spreadsheet release.
- `fulfilledQuantity` and admin order status can still disagree with committed allocations. The same gap was already open on LO-1057.
- Release notification skipped because the portal login email was missing.
- Buyer CSV `State` still emits raw source text. Do not rewrite the released file.
- PR #161's transaction budget is deployed. An 85-lead commit fits. A 300-lead commit after the fix was not re-measured. Batching remains open, so the reservation card moved to Verify / P1 rather than Done.
- Operator review is already enabled on the API app. Supplemental-fill code from #178 is deployed and not yet accepted on a live small order.
- A generic order verifier was not added.
- Issue #71 is still open.
- Reserved, exported, released, and delivered remain different states. LO-1055's release wrote delivery identities and did not perform an external GHL write.

## 11. Major blockers and release risks

1. **`FACEBOOK_DIRECT_INTAKE_ENABLED=true`** on the active API spec. Effective Meta routing can run while the three explicit flags look off. Needs an operator decision. This audit left the flag alone.
2. **Receipt migrations are not proven by a table read.** Suppression is on. A missing receipt table fail-closes buyer fulfillment.
3. **Vanessa file, buyer identity, and dry-run counts are not in hand.** Applying the 3,304-row export would be the wrong action.
4. **Inventory map is already visible if the flag is honored**, without a recorded activation approval or a fresh customer check.
5. **Meta review cannot be filmed yet.** API review flag is off, allowlists and tokens are empty, and the legacy alias is on.
6. **Admin order counters and the customer CSV still lie about an otherwise successful delivery.**
7. **GHL mode is `live_canary`.** That canary is a separate gate from spreadsheet fulfillment (issue #54).
8. **Draft PR #180** is useful evidence and also stale on the debug-route point. Do not treat it as merged.

## 12. Prioritized backlog

### P0 — critical path

1. Remove `FACEBOOK_DIRECT_INTAKE_ENABLED=true` and re-read the effective Meta flags.
2. Finish the Meta review environment (allowlists, tokens, Page binding, app id, matching review flag) without enabling writes or routing.
3. Record the four authentic permission videos.
4. Confirm #178/#179 migrations on production.
5. Accept deployed #177 quality, #178 operator review, and #179 suppression on controlled evidence.
6. Locate and reconcile Vanessa's workbook. Do not import it.
7. Validate the inventory map that is already flagged on.
8. Keep the first controlled operator-review order behind the migration evidence and the Meta flag decision. LO-1055 does not close this.
9. Prove issue #155: shared phone or email does not merge different clients' source submissions, and buyer suppression stays buyer-specific.
10. Only then schedule `leads_retrieval` and the capture-only canary.

### P1 — next

- Drafts #174, #175, #176, and the #158 close/keep decision.
- `fulfilledQuantity` / status reconciliation.
- Missing portal-email notification.
- Buyer CSV State normalization, without rewriting released files.
- Large-batch reservation measurement and a batching design.
- Reusable read-only order verifier.
- Returns, credits, and replacements (issues #49 and #50). PR #178's supplemental fill is only part of this.
- Client name on the Stage 2 selector (issue #71).
- Front Office Inventory Explorer live data (issue #51).
- Payment and credit reconciliation, external delivery fallback, and operational dashboards already on the board.

### P2 — later

Expanded CRM connectors, broad voice AI, nonessential UI polish, forecasting, and marketing work that does not block fulfillment. The existing Later column was left in place, including the Alex-owned "Aged Lead Orders" placeholder, which is now noted as superseded by the specific fulfillment cards.

## 13. Dependency graph

```text
Unset FACEBOOK_DIRECT_INTAKE_ENABLED
  -> Meta review env completed (allowlists, tokens, API review flag)
    -> four read-only permission videos
  -> separately approved capture-only canary
    -> authentic leads_retrieval evidence

Confirm #178/#179 migrations
  -> accept operator review and receipt suppression
    -> Vanessa workbook reconciliation and dry run
      -> written import approval
        -> controlled import
          -> eligibility and duplicate-delivery check

Inventory map flag (already true)
  -> benchmark, exclusions, tenant isolation, stale behavior, customer check

LO-1055 spreadsheet success
  -> counter reconciliation, State normalization, notification, verifier
  -> does not unblock Vanessa or the GHL canary

Issue #155 source identity
  -> required before treating buyer suppression as safe across clients
```

## 14. Next launch gates

1. Legacy Meta alias removed and explicit routing still false.
2. Production migration names for #178 and #179 recorded by an operator.
3. Receipt import still false.
4. Vanessa workbook reconciled and not imported.
5. Inventory map either confirmed as intentionally on, or a later approved change; plus a customer-session check.
6. One small non-Vanessa operator-review order, with reserved / exported / released / delivered counts agreeing.
7. Meta videos and `leads_retrieval` only after gates 1 and the separate canary approval.
8. GHL `live_canary` remains its own gate (issue #54), with Zapier and Sheets still available.

## 15. Decisions required

| Decision | Who | Why it is blocking |
| --- | --- | --- |
| Unset `FACEBOOK_DIRECT_INTAKE_ENABLED` on the API app | Sam | Effective routing is on via the legacy alias. |
| Whether the inventory map flag was intentionally set true | Sam | It is already true. This audit will not flip it. |
| Record `_prisma_migrations` for the four new folders | Sam, or whoever holds production DB read access | Inferred from the active migrate job only. |
| Approve or refuse the Vanessa import after a dry run | Sam | Not authorized now. |
| Which person holds the Meta app role for videos and the data-deletion URL field | Sam; Matt or Aaron if they hold the Business asset | Dashboard was not opened. |
| Confirm Vanessa's buyer identity and the phone-or-email rule, including shared inboxes | Sam and Alex | User-reported counts only. |
| When Alex runs the first small operator-review order | Alex, after Sam clears the gates above | Draft #180's checklist is not merged and the Meta flag is still wrong. |
| Close or keep draft #158 | Reviewer after comparing it with #172 | Not confirmed superseded. |

Aaron remains the owner of the existing "Delegate Tasks to Aaron" card. No new work was assigned to Aaron or Matt beyond the Meta asset question.

## 16. Next actions and verification evidence

Do these in order. Do not import Vanessa, do not subscribe a Page, and do not set `FACEBOOK_DIRECT_INTAKE_ENABLED` to anything except unset or false.

1. Sam unsets the legacy Meta alias and reads back intake, Graph fetch, and routing as false.
2. Operator copies the applied migration names for `20261013160000` through `20261013190000`.
3. Configure review allowlists, Page binding, review app id, and review user token on the API only. Set `SA360_META_REVIEW_ENABLED` on the API to match Admin C.O.C. only when those values exist. Leave writes and the three intake flags false.
4. Record the four permission videos from real Graph responses.
5. Put the Vanessa workbook in the operator's secure store, not in git, and reconcile 3,260 / 44 / 3,304.
6. Sign in as a portal customer and check the inventory map against one known niche, age bucket, and state, including a stale or failed aggregate.
7. Run a 3-lead purchased plus 1 unbilled buffer order only after items 1–2. Keep receipt import off.
8. Fix `fulfilledQuantity`, the missing portal email notification, and CSV State as product work that does not rewrite LO-1055's released file.

Evidence already stored for this reconciliation:

- API health commit `2e2a9e1` at 14 October 2026, about 18:02 UTC.
- Active deployment ids `73798a03-c9e1-402f-b26d-2b0b183b4378` (`sa360`) and `8bdeea9d-7123-4888-920e-1bd4af461732` (`sa360-admin-coc`).
- Live Kanban readback: 98 cards, board key `sa360_beta_mvp_launch`, zero duplicate titles.
