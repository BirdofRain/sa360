# Meta App Reviewer access

Restricted sign-in for external Meta App Review. Reviewers inspect the existing
read-only `/meta-review` workspace. They do not receive Admin C.O.C. operator
access, the admin API key, or Meta tokens.

Do not deploy, merge, or change production credentials from this document until
an operator explicitly approves the release. Do not enable lead intake, Graph
fetch, routing, fulfillment, GHL delivery, or CAPI. Do not change Page
subscriptions or generate leads.

## Authentication design

| | Admin C.O.C. operator | Meta App Reviewer |
| --- | --- | --- |
| Login | `GET /login` (unchanged) | `GET /meta-review/login` |
| Password | `ADMIN_COC_PASSWORD` | `SA360_META_REVIEWER_PASSWORD` (scrypt verifier only) |
| Cookie | `sa360_admin_session` | `sa360_meta_reviewer_session` |
| Role claim | `ADMIN` or `SA360_OBSERVER` | `meta_reviewer` |
| Token prefix | `ac1` / typ `admin_coc` | `mr1` / typ `meta_reviewer` |
| Lifetime | 30 days | 12 hours (hard maximum 24 hours) |
| Cookie flags | HttpOnly, SameSite=Lax, Secure in production | Same |

A reviewer token does not verify as an admin or observer session. An admin
session continues to open `/meta-review`, including the subscription control
when the separate write flag allows it. Reviewer sessions never see that
control and cannot call the subscription POST, even when
`SA360_META_REVIEW_WRITES_ENABLED=true`.

The browser never receives `SA360_ADMIN_API_KEY`. After the server confirms a
reviewer session and an allowlisted GET, Admin C.O.C. attaches that existing
server-only key to the Fastify admin API. Meta tokens stay on the API service.

Login fails closed when the workspace flag is off, the verifier is missing or
not a `scrypt$` string, or no usable signing secret exists. Failures return
one message: `Sign-in failed.` Eight failures from the same client address
inside 15 minutes are rejected the same way. There is no `next` parameter.

Logout is `POST /meta-review/logout`. It clears only the reviewer cookie and
returns to `/meta-review/login`. `GET` is rejected. The origin must match the
forwarded host.

## Environment variables

Set the new variables on the **Admin C.O.C.** component only, as encrypted
secrets. Do not create `NEXT_PUBLIC_` copies. Do not put the reviewer password
or verifier on the API service.

| Variable | Component | Secret | Required | Default | Purpose |
| --- | --- | --- | --- | --- | --- |
| `SA360_META_REVIEWER_PASSWORD` | Admin C.O.C. | **Yes** | Yes, for reviewer login | unset | Scrypt verifier. Plaintext is rejected. |
| `SA360_META_REVIEWER_SESSION_SECRET` | Admin C.O.C. | **Yes** | Recommended | unset | HMAC secret, minimum 16 characters. When unset, reviewer cookies are signed with `ADMIN_COC_SESSION_SECRET`. A dedicated value that is too short fails closed and does not fall back. |

Leave these as they already are unless a separate change says otherwise:

`SA360_META_REVIEW_ENABLED`, `SA360_META_REVIEW_WRITES_ENABLED`,
`ADMIN_COC_PASSWORD`, `ADMIN_COC_SESSION_SECRET`, `SA360_ADMIN_API_KEY`,
`NEXT_PUBLIC_SA360_API_BASE_URL`, and every Meta token on the API.

Phase A values stay:

```text
SA360_META_REVIEW_ENABLED=true
SA360_META_REVIEW_WRITES_ENABLED=false
SA360_META_LEAD_ADS_INTAKE_ENABLED=false
SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED=false
SA360_META_LEAD_ADS_ROUTING_ENABLED=false
FACEBOOK_DIRECT_INTAKE_ENABLED=<unset>
```

`SA360_META_REVIEW_ENABLED=true` must be set on Admin C.O.C. as well as the API.
When it is not `true`, `/meta-review/login` is a 404 and sign-in fails closed.

## Mint the verifier

Run this on a trusted operator machine, not in production shell history and not
in the repository. Choose a password of at least 20 random characters. Share
that password with Meta only through the private credentials field in App
Review. Store the command's stdout, which is the verifier, in the encrypted
env var.

```bash
cd apps/admin-coc
REVIEWER_PASSWORD_INPUT='replace-with-a-long-random-password' \
  pnpm exec tsx --import ./scripts/register-server-only-stub.ts \
  ./scripts/hash-meta-reviewer-password.ts
```

Unset `REVIEWER_PASSWORD_INPUT` afterward. Do not paste the password or the
verifier into tickets, recordings, or source control.

Also generate `SA360_META_REVIEWER_SESSION_SECRET` (at least 16 random
characters, distinct from `ADMIN_COC_SESSION_SECRET` and
`CLIENT_PORTAL_SESSION_SECRET`). Setting it lets you revoke reviewer sessions
without signing out Sam, Matt, Aaron, or Alex.

## Build and test before deploy

From the repository root, against this branch:

```bash
pnpm --filter @sa360/admin-coc test
pnpm --filter @sa360/admin-coc lint
pnpm --filter @sa360/admin-coc build
pnpm exec tsx --import ./apps/api/src/test/set-test-env.ts --test apps/api/src/routes/admin-meta-review.routes.test.ts
```

The API route file does not need a database. Do not point tests at a remote
database.

## DigitalOcean deploy sequence

1. Read back the current Admin C.O.C. and API env. Confirm Phase A flags above
   and that operator passwords are unchanged.
2. On the **admin-coc** component, add encrypted
   `SA360_META_REVIEWER_PASSWORD` (the verifier) and encrypted
   `SA360_META_REVIEWER_SESSION_SECRET`.
3. Confirm `SA360_META_REVIEW_ENABLED=true` on admin-coc and the API, and
   `SA360_META_REVIEW_WRITES_ENABLED=false` on the API.
4. Deploy **only** the Admin C.O.C. component from the approved commit. The API
   contract is unchanged; a API redeploy is unnecessary for this feature.
5. Do not open a Meta token screen while recording.

### URLs

| | URL |
| --- | --- |
| Reviewer login | `https://portal.lifeagentlaunch.com/meta-review/login` |
| Workspace | `https://portal.lifeagentlaunch.com/meta-review` |
| Logout | `POST https://portal.lifeagentlaunch.com/meta-review/logout` |

Operator login remains `https://portal.lifeagentlaunch.com/login`.

## Post-deploy smoke tests

Use a private browser profile. Do not use an operator password.

1. `GET /meta-review/login` returns 200, shows **Meta App Review Access** and
   **Sign In**, and does not show Central Operating Center, client names, or
   the operator login.
2. A wrong password shows `Sign-in failed.` and does not set
   `sa360_meta_reviewer_session`.
3. The reviewer password sets that cookie (HttpOnly, Secure, SameSite=Lax) and
   lands on `/meta-review`.
4. The workspace shows **READ ONLY**, the allowlisted Page, and the allowlisted
   ad account. **Subscribe leadgen** is absent.
5. **Load authorized Pages**, **Check granted permissions**, **Inspect
   subscribed apps**, **Load Page posts**, and **Load campaign insights** return
   sanitized Graph results with HTTP status and timestamp.
6. **Sign Out** returns to `/meta-review/login` and the reviewer cookie is gone.
7. An existing operator can still open `/login` and `/meta-review` with the
   admin session. Operator navigation is unchanged.

## Negative authorization tests

With only the reviewer cookie:

| Request | Expected |
| --- | --- |
| `GET /clients`, `/action-center`, `/webhooks`, `/lead-timeline`, `/portal`, `/lead-inventory` | 403 Forbidden, no customer data and no operator login |
| `GET /api/agent-workspace` | 403 |
| `POST /admin/v1/meta-review/pages/{id}/subscribe-leadgen` on the API, no `x-sa360-admin-key` | 401, including when writes are enabled |
| Reviewer UI subscribe control | Not rendered |
| Direct server action for subscription POST | 403, no Graph call |

Confirm the response bodies do not contain Meta tokens, the admin API key, or
the reviewer verifier.

## Rollback

1. On Admin C.O.C., delete `SA360_META_REVIEWER_PASSWORD` or replace it with an
   empty value.
2. Rotate `SA360_META_REVIEWER_SESSION_SECRET` to a new random value.
3. Redeploy Admin C.O.C.
4. Confirm `/meta-review/login` returns `Sign-in failed.` for the previous
   password and operator `/login` still works.
5. Do not change intake, routing, fulfillment, or Meta subscription flags as
   part of this rollback.

## Revoke access after App Review

1. Remove `SA360_META_REVIEWER_PASSWORD`.
2. Rotate `SA360_META_REVIEWER_SESSION_SECRET`.
3. Redeploy Admin C.O.C.
4. Outstanding reviewer cookies die with the secret rotation; the 12-hour
   lifetime is the upper bound if the secret is left in place.
5. Keep `SA360_META_REVIEW_ENABLED` unchanged until a separate decision retires
   the evidence workspace. Turning it off makes `/meta-review` and the reviewer
   login 404.
6. Do not rotate `ADMIN_COC_SESSION_SECRET` unless you intend to sign out every
   operator. That rotation is required to kill reviewer cookies only when the
   dedicated reviewer secret was never set.

## Reviewer instructions

Send this text to Meta. Send the password only in the private test-credentials
field.

> Open https://portal.lifeagentlaunch.com/meta-review/login
>
> Sign in with the restricted review password supplied privately in Meta App
> Review. The page heading is Meta App Review Access.
>
> The workspace is read-only. Use these controls:
>
> - Load authorized Pages — page discovery
> - Inspect subscribed apps — existing leadgen subscription readback
> - Load Page posts — Page-owned posts
> - Load campaign insights — campaign insights for the listed ad account
>
> Each panel shows the sanitized Graph endpoint, HTTP status, and timestamp.
> No personal Facebook Login is required. This login does not grant access to
> real customer data, customer fulfillment, or lead delivery.
>
> Sign Out is at the top of the workspace.
>
> For help, contact support@lifeagentlaunch.com.

## Go / no-go

- **Local implementation:** GO only after the test, lint, and build commands
  above pass.
- **Production deploy:** NO-GO until an operator approves, the encrypted
  verifier and dedicated session secret are set, and Phase A flags are read
  back.
- **Subscription mutation, intake, routing, fulfillment, and new leads:** NO-GO.
- **Handing an operator password to Meta:** NO-GO.
