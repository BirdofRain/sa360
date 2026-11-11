# Staff principal and permission foundation

Status: **schema only**. No staff login, invitation, permission administration,
session change, correction route, or production identity.

SA360 staff authentication will use Google Sign-In through OpenID Connect.
Native username/password authentication for staff is not a future option.
This schema stores the identity and the explicit permission. It does not
perform the login.

Google staff sign-in stays separate from the existing Google Drive and Sheets
OAuth integration (`GoogleAccountConnection`, `CompanyGoogleConnection`).
Those tables keep Drive and Sheets tokens. `StaffPrincipal` stores no token,
no refresh secret, and no password.

## Models

`StaffPrincipal` is one provisioned person.

| Field | Meaning |
| --- | --- |
| `id` | Stable cuid. Immutable. Retained for later audit records. |
| `email` | Normalized unique mailbox. A label, not proof of authentication. |
| `emailVerified` | Later IdP claim. `true` does not grant access or a permission. |
| `displayName` | Optional. |
| `provider` | `google` only. The intended or bound provider. |
| `providerSubject` | Google's `sub`, or null until a verified login binds it. Immutable once set. |
| `status` | `disabled` (default) or `active`. |
| `disabledAt` | Set while disabled. Null while active. |

A generic insert stays disabled because `status` defaults to `disabled` and
`disabledAt` defaults to the current time. Activation is one write that sets
`status` to `active` and `disabledAt` to null.

`StaffPermission` is one explicit grant to one principal.

| Field | Meaning |
| --- | --- |
| `id` | Stable grant id. |
| `staffPrincipalId` | Required foreign key. `ON DELETE RESTRICT`, `ON UPDATE RESTRICT`. |
| `permission` | `facebook_association_correction` or `admin_coc`. Neither implies the other. |
| `status` | `granted` or `revoked`. There is no default. |
| `grantedAt` | When this grant row was created. Immutable. |
| `revokedAt` | Null while granted. Set when revoked. Immutable once set. |

There is no role table and no role column. A shared-password Admin C.O.C.
session, Team Workspace credential, customer portal session, observer cookie,
Meta reviewer session, or Agent Workspace credential does not create this
permission. `admin_coc` is the grant that later authorizes Admin C.O.C. for
a staff principal. See `docs/architecture/staff-admin-coc-access.md`.

## Lifecycle

1. A future invite or explicit provision inserts a `StaffPrincipal`. The row
   starts disabled, with a normalized email and a null `providerSubject`.
   Signing in with a Google account does not insert this row.
2. Activation sets `status = active` and `disabledAt = null`. The person still
   has no permission.
3. A future verified Google login may set `providerSubject` from the `sub`
   claim once. Email is not the binding. After `providerSubject` is set, the
   provider and the subject cannot change. Email can still change, and it must
   stay normalized and unique.
4. A grant inserts a `StaffPermission` with `status = granted`. That is the
   only way to hold `facebook_association_correction`.
5. Revocation updates that row to `status = revoked` and sets `revokedAt`.
   The row stays. It cannot be flipped back to `granted`. A replacement grant
   is a new row.
6. Disabling the principal sets `status = disabled` and `disabledAt`. Existing
   grant rows stay. They no longer authorize.

The authorization predicate, which a later API must evaluate against live
rows, is:

```sql
SELECT p."id"
FROM "StaffPermission" p
JOIN "StaffPrincipal" s ON s."id" = p."staffPrincipalId"
WHERE p."staffPrincipalId" = $principal
  AND p."permission" = 'facebook_association_correction'
  AND p."status" = 'granted'
  AND p."revokedAt" IS NULL
  AND s."status" = 'active'
  AND s."disabledAt" IS NULL;
```

No row means denial. A revoked grant means denial. A disabled principal means
denial even when the grant row is still `granted`.

`StaffPermission_one_effective_grant_key` allows at most one `granted` row per
principal and permission. Revoked rows are outside that index. Prisma 6 cannot
express the filter, so the index is raw SQL. If `prisma migrate diff` proposes
dropping it, reject the drop.

Delete and truncate of either table are rejected. Principal ids and grant rows
remain available for a later immutable audit record. This migration does not
add that audit table and does not record who granted or revoked a permission.

## What this does not change

- Admin C.O.C. login still uses the shared password session (`ac1`, role
  `ADMIN` or `SA360_OBSERVER`). That session is not a `StaffPrincipal`.
- `x-sa360-admin-key` still authorizes the existing admin API, including Team
  Workspace reads and the read-only association correction preview. It does
  not insert a staff permission.
- `x-sa360-operator` remains an unauthenticated label on existing admin
  writes. It is not a principal.
- Portal keys, portal assertions, Agent Workspace keys, observer cookies, and
  Meta reviewer credentials are unchanged and do not grant
  `facebook_association_correction`.

## Migration

`20261109210000_staff_principal_permission_foundation` adds two empty tables,
four enums, checks, the partial unique index, and the retention triggers.
Merging it makes `sa360-migrate` apply it on the next API predeploy. That
apply creates empty tables only. It does not insert a person, grant a
permission, or change login. It locks no existing application table.
`lock_timeout` is 3 seconds.
On a non-loopback database it grants `sa360_app` select, insert, update, and
delete on the new tables only. It does not create a role or a password.
Loopback databases without `sa360_app` skip that grant.

No seed inserts a principal or a permission.

### Rollback

Before any staff row exists, recovery is a forward migration that drops the
two tables, the four enums, and the four functions. Do not edit this
migration after it is applied, and do not delete its `_prisma_migrations` row
by hand except through `prisma migrate resolve` during a failed deploy.

After a principal or a grant exists, dropping the tables destroys the ids
that later audit rows must keep. Recovery is then a forward change that
disables principals and revokes grants, not a drop.

Applying the migration twice is a no-op. A failed attempt before `COMMIT`
rolls the new objects back. Prisma can still record that failed attempt;
recovery remains `prisma migrate resolve --rolled-back` and another deploy.
This file does not authorize that recovery in production.

## Deferred to a later approved phase

- Google authorization-code routes, redirect URIs, state storage, and CSRF protection.
- Server-side ID token checks: issuer, audience, JWKS, nonce, and `email_verified`.
- The Google OAuth client used for staff sign-in. It must not be the Drive or Sheets client, and its tokens must not be written onto `StaffPrincipal`.
- Session cookie name, signing key, lifetime, and rotation. Do not reuse `ADMIN_COC_SESSION_SECRET`.
- How first login binds `providerSubject`: only onto an already provisioned principal, never by inserting one. The email-match rule and the required `email_verified` value are not decided here.
- Google email changes that keep the same `sub`.
- Invitation and permission-administration routes, and who may call them.
- Actor columns for grant and revocation.
- Correction POST routes and any use of this permission to mutate a lead.
- The immutable audit table that will store `staffPrincipalId`.
