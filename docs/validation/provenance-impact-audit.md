# Inventory provenance impact audit

Read-only measurement route for policy `ppl-provenance-eligibility-v1` (the policy in unmerged PR #188). This document is the operator runbook. It does not record a production inventory measurement.

**Production inventory impact has not been measured.** The API always returns `productionImpactMeasured: false`. A local or staging snapshot is not a production result. Do not treat any count as the business impact of merging PR #188 until all of the following are true:

1. This route is deployed on the production API.
2. `SA360_PROVENANCE_AUDIT_ENABLED=true` is set on that production API process only.
3. `GET /admin/v1/fulfillment-ops/provenance-impact` returns `ok: true` and `complete: true`.
4. `database.name` and `database.serverAddress` in that response are the production database.

PR #188 stays unmerged and undeployed. This audit does not select, reserve, export, or exclude inventory.

## Route

`GET /admin/v1/fulfillment-ops/provenance-impact`

No query string. Any query parameter returns `400 provenance_impact_filters_rejected`. The handler does not accept SQL, table names, or filters.

When `SA360_PROVENANCE_AUDIT_ENABLED` is anything other than the exact string `true`, including unset, the route returns `404` with `code: provenance_impact_audit_disabled` and does not open a database transaction.

Authentication, in order after the flag check:

- Existing admin header `x-sa360-admin-key`, compared with `ADMIN_API_KEY` or `SA360_ADMIN_KEY` using a SHA-256 digest and `timingSafeEqual`.
- Or, only on this route, header `x-sa360-provenance-audit-key` compared with `SA360_AUDIT_READONLY_KEY`.

The audit key is accepted only when it is at least 16 characters and is different from `ADMIN_API_KEY`, `SA360_ADMIN_KEY`, `SA360_ADMIN_API_KEY`, and the resolved admin key. It does not authenticate any other admin route. Admin C.O.C. keeps using the existing server-side admin key. Do not put the audit key in the Next.js app or in any `NEXT_PUBLIC_` variable.

The aggregate runs in one PostgreSQL `REPEATABLE READ` `READ ONLY` transaction with `statement_timeout` of 120 seconds. If the snapshot, timeout, reconciliation, or response scan fails, the route returns `503` with `ok: false`, `complete: false`, and no numeric totals.

Verified-acquisition evidence is hardcoded as `NULL::text`. There is no persisted verified-acquisition lookup in this schema. An arbitrary string in metadata, exclusivity, or a campaign label is not proof.

The structural gate is available, aged inventory on an active lot that is not commerce-excluded. Same-origin buyer exclusion is not applied. Campaign-label recovery is counts only. Label text, contact fields, customer names, and raw lead payloads are not selected into the response.

## DigitalOcean API environment variables

Set these on the **API** app only. Do not set them on the Admin C.O.C. / Next.js app. Do not set them until the code is deployed and a disabled `404` has been confirmed.

| Variable | Required to enable | Value |
| --- | --- | --- |
| `SA360_PROVENANCE_AUDIT_ENABLED` | Yes, to turn the route on | Exact `true`. Unset, empty, or any other value keeps the route at `404`. |
| `SA360_AUDIT_READONLY_KEY` | No | Optional. At least 16 characters. Must differ from `ADMIN_API_KEY`, `SA360_ADMIN_KEY`, and `SA360_ADMIN_API_KEY` if that variable is present on the API. Send only as `x-sa360-provenance-audit-key` to this route. |
| `ADMIN_API_KEY` or `SA360_ADMIN_KEY` | Already required | Existing admin credential. Admin C.O.C. continues to send it as `x-sa360-admin-key` from the server. Do not rotate it for this audit. |

Do not add `SA360_PROVENANCE_AUDIT_ENABLED` or `SA360_AUDIT_READONLY_KEY` to the Admin C.O.C. app. Do not create `NEXT_PUBLIC_SA360_PROVENANCE_AUDIT_ENABLED` or `NEXT_PUBLIC_SA360_AUDIT_READONLY_KEY`.

No database URL, role, or migration change is required. No schema migration ships with this route.

## Admin C.O.C. test instructions

Use a local API and a local Admin C.O.C. pointed at that API (`NEXT_PUBLIC_SA360_API_BASE_URL`). Use the local disposable database. Do not point this check at production.

1. Leave `SA360_PROVENANCE_AUDIT_ENABLED` unset on the API. Restart the API.
2. Sign in to Admin C.O.C. with the operator password. Do not use an observer password or a customer portal session.
3. Open `/fulfillment-ops`.
4. Confirm the **Inventory Provenance Impact** panel is directly under the page header.
5. Confirm the panel says the audit is off and names `SA360_PROVENANCE_AUDIT_ENABLED=true`.
6. Confirm the panel does not show Available before gate, Blocked by gate, Remaining after gate, or any zero totals.
7. Sign in as an observer. `/fulfillment-ops` is not in the observer allowlist and must not render the panel. `GET /api/fulfillment-ops/provenance-impact` returns `403`.
8. A customer portal session on `/fulfillment-ops` redirects to `/login`. Portal routes do not mount this panel.
9. To see local counts, set `SA360_PROVENANCE_AUDIT_ENABLED=true` on the **local API process only**, restart that process, and reload `/fulfillment-ops` as an admin.
10. Confirm the panel shows the local database name, the four headline figures, niche and lot rows, campaign-label recovery counts, and at-risk order numbers.
11. Confirm the banner still says production inventory impact is not measured.
12. Unset the flag and restart the API. The panel returns to the disabled state with no totals.

Direct API checks against the local API:

- Flag unset, with or without a valid admin key: `404` `provenance_impact_audit_disabled`.
- Flag on, no key: `401`.
- Flag on, audit key sent as `x-sa360-admin-key`: `401`.
- Flag on, audit key sent as `x-sa360-provenance-audit-key`: `200` with `productionImpactMeasured: false`.
- That same audit key on any other admin route, including order create, selection, reserve, and review commit: `401`.
- `?niche=trucker` or any other query: `400`.

## Enable

1. Deploy this API change with the flag unset.
2. Request the route and confirm `404` `provenance_impact_audit_disabled`.
3. Set `SA360_PROVENANCE_AUDIT_ENABLED=true` on the API app and restart or redeploy that app only.
4. Optionally set a distinct `SA360_AUDIT_READONLY_KEY` on the API app. Keep it out of Admin C.O.C. and out of logs.
5. Query as an admin session through `/fulfillment-ops`, or with `x-sa360-admin-key` / `x-sa360-provenance-audit-key`.
6. Require `ok: true`, `complete: true`, and a `database` identity that is production before anyone uses the figures. `productionImpactMeasured` remains `false` in the JSON; the operator confirms the database identity outside this field.
7. A `503` with `complete: false` is not a zero inventory result. Do not enable PR #188 from a failed audit.

## Disable and rollback

1. Unset `SA360_PROVENANCE_AUDIT_ENABLED`, or set it to any value other than `true`, on the API app.
2. Restart the API.
3. Confirm the route returns `404` `provenance_impact_audit_disabled`.
4. Admin C.O.C. then shows the disabled panel and no totals.
5. Removing `SA360_AUDIT_READONLY_KEY` disables only the audit-key header. The admin key still works while the flag is `true`.
6. There is no migration to roll back and no inventory, allocation, or lead row to revert. The transaction is `READ ONLY`.
7. Reverting this code removes the route. PR #188 is a separate change and is not deployed by enabling or disabling this flag.

## Production access blockers

- This environment has no production database credentials and must not be given them to finish this change.
- The flag defaults off. Deploying the code does not run the audit.
- The route has not been deployed or enabled on the production API.
- No production query has been executed, so no production count in this repository is a measurement.
- Verified-acquisition rows cannot be cleared by this audit. The schema has no authenticated verified-acquisition lookup, and the SQL passes `NULL`.
- Structural counts are not buyer-specific. Same-origin exclusion still depends on the buyer and is outside this report.
- Other admin routes may use a read-write database role. This route's transaction is `READ ONLY`, and the audit key cannot call those other routes.
- If the statement times out or the snapshot cannot be reconciled, the response is incomplete and withholds totals.
