# Parallel Agent Work — Ownership & Merge Policy

This repository is developed by 3–4 Cursor Cloud Agents running concurrently. Each agent works
on its own isolated branch and finishes with a reviewable PR. To keep parallel work conflict-free
and safe, every agent operates inside one **workstream lane** with a defined ownership boundary.

Read this together with the root `AGENTS.md` (mandatory rules) and the nested `AGENTS.md` files
under `apps/*` and `prisma/`.

## Global principles

- Stay inside your lane. If a task needs changes in another lane's owned area, **stop that
  portion** and document the dependency (root rule 9) instead of expanding scope.
- Prefer targeted changes; never introduce a second implementation of an existing source of
  truth (root rules 4 and 10).
- Preserve external API contracts (HTTP routes, webhook payloads, auth headers, DB semantics)
  unless the task explicitly changes them (root rule 3).
- Only the **Auth/Account lane** may create Prisma migrations, and only when its task explicitly
  authorizes it. All other lanes are migration-free unless explicitly authorized.

## Workstream lanes

### Ingestion Agent
- **Owns:** webhook ingestion, source adapters, normalization, and routing ingestion logic, plus
  the related API tests. Primary code: `apps/api/src/routes/webhook*.ts`,
  `apps/api/src/routes/sources-*.ts`, `apps/api/src/routes/voice*.ts`,
  `apps/api/src/services/source-intake/`, `apps/api/src/services/routing-*`,
  `apps/api/src/services/leadcapture-*`, `apps/api/src/services/synthflow-*`.
- **Avoid:** portal and auth changes.
- **Prisma:** no migration unless explicitly authorized.

### Portal Agent
- **Owns:** customer-facing portal UX, components, responsive layouts, frontend adapters, and
  loading/error/empty states. Primary code: `apps/admin-coc/src/app/portal/**`,
  `apps/admin-coc/src/components/client-portal/**`, `apps/admin-coc/src/client-portal/`.
- **Must not** modify Prisma.
- **Must not** redesign auth architecture.
- **Must not** invent backend write behavior when an API does not exist — document the missing
  endpoint as a dependency instead.

### Auth/Account Agent
- **Owns:** authentication, authorization, users, account memberships, tenant boundaries, and
  role enforcement. Primary code: `apps/api/src/lib/auth.ts`, `apps/api/src/lib/admin-auth.ts`,
  `apps/api/src/lib/client-portal-auth.ts`, `apps/api/src/lib/workspace-auth.ts`,
  `apps/api/src/lib/*-webhook-auth.ts`, `apps/api/src/lib/ghl-oauth*.ts`,
  `apps/api/src/services/client-portal-tenant.service.ts`, and portal auth/session in
  `apps/admin-coc/src/middleware.ts`.
- **This is the ONLY parallel lane permitted to create Prisma migrations.**

### Quality Agent
- **Owns:** contained bug fixes, Admin C.O.C. robustness, test/CI improvements, and regression
  work across the codebase.
- **Must not** redesign product architecture.
- **Must not** create migrations.

## Ownership boundary quick reference

| Area | Owning lane |
| --- | --- |
| Webhooks, source adapters, normalization, routing ingestion | Ingestion |
| Customer portal UX/components/adapters (`/portal`) | Portal |
| Auth, authz, users, memberships, tenants, roles, sessions | Auth/Account |
| Prisma schema & migrations | Auth/Account (only, when authorized) |
| Admin C.O.C. robustness, bug fixes, tests/CI, regressions | Quality |

## Merge policy

- Parallel PRs are **merged individually into `master`** — never batch-merge interacting
  branches together.
- Between two PRs that could interact (shared files, shared contracts, or a schema change),
  **rebase/merge the second branch onto the updated `master` and re-run the relevant tests and
  builds against updated `master` before merging.** Do not merge a stale branch that has not
  been re-validated against the latest `master`.
- Migration PRs (Auth/Account lane) merge first when other in-flight PRs depend on the new
  schema; dependent lanes then rebase onto updated `master` and re-run tests.
- If a rerun against updated `master` fails, fix the root cause on the branch (never skip or
  weaken tests) before merging.
