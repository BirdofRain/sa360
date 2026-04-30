# SA360 Central Operating Center (C.O.C.) — Design brief

This document captures **layout, hierarchy, spacing, and UX intent** for the internal admin dashboard. The **production app** is `apps/admin-coc` (Next.js, Tailwind, shadcn/ui). It is **not** a Figma export or codegen dump.

---

## Figma reference (MCP)

**Status:** The Cursor Figma MCP server (`plugin-figma-figma`) was **not authenticated** in this workspace (`mcp_auth` required). No live frame inspection was performed.

**To sync design tokens from Figma after you authenticate:**

1. Complete MCP authentication for the Figma server in Cursor.
2. Select the relevant C.O.C. frames in Figma (Command Center, Webhook Monitor, Synthflow monitor, detail drawer).
3. Re-run a short design pass: extract **spacing scale** (e.g. 4/8/12/16/24), **corner radius**, **neutral palette** (background, surface, border, muted text), **status colors** (success, warning, error), and **table column order**.
4. Update this file under **“Figma deltas”** with measured values and link the Figma file URL + node IDs.

Until then, the UI follows a ** restrained B2B SaaS** baseline: neutral surfaces, subtle borders, no decorative gradients, clear error/warning states.

---

## Product principles (beta)

- **Observability first:** tables, filters, JSON inspection, and environment clarity beat marketing polish.
- **Desktop-first:** primary layout assumes ≥1280px width; smaller viewports should scroll horizontally for wide tables rather than hiding critical columns without an alternative.
- **No secrets in UI:** tokens, API keys, and full PII are out of scope for display; use redacted previews when wiring data.
- **Environment visibility:** operators must always see whether they are in **STAGING** vs **PRODUCTION** (badge in header).

---

## Information architecture (routes)

| Route | Purpose |
|-------|---------|
| `/` | Command Center — KPI strip, latest activity, critical issues |
| `/webhooks` | GHL lifecycle webhook monitor — table + detail drawer |
| `/synthflow` | Inbound lookup monitor |
| `/clients` | Client + subaccount management |
| `/review` | Review / error queue |
| `/flags` | Feature flags (env + future DB) |
| `/settings` | API base URL hint, health endpoint reference |

---

## Layout shell (implemented)

**App frame**

- Full viewport height (`min-h-dvh`).
- **Horizontal split:** fixed **sidebar** + fluid **main**.

**Sidebar (reference width: 240px)**

- Background: semantic `sidebar` token (light gray surface, distinct from main `background`).
- Top **brand row** (~56px): product label `SA360 · C.O.C.`.
- **Primary navigation:** vertical list, icon + label, **active** state uses `sidebar-accent`.
- **Footer note:** short beta / “no live data” disclaimer (replace when API is connected).

**Main column**

- **Header** (sticky, ~56px): page **title** + optional **subtitle** (muted); right-aligned **environment badge**.
- **Content:** `p-6` (24px) padding; pages own vertical `space-y-*` rhythm.

**Figma alignment tip:** Match sidebar width, header height, and content padding to your frames first; component-level tweaks follow.

---

## Component hierarchy (by screen)

### Command Center

1. Section label (muted, small caps optional).
2. **Stat row:** responsive grid — 1 col mobile, 2 sm, 4 lg; each cell is a **card** with label, large metric, optional hint.
3. **Two-up cards:** “Latest activity” + “Critical issues” (equal priority below the fold on large screens).

### Webhook Monitor

1. **Filter row** (disabled until API): client + status inputs; future date range.
2. **Table** in a **rounded bordered container** (`rounded-xl border bg-card`).
3. **Columns (target order):** time, source, route, status, client, subaccount, contact, event, known caller, duration, result.
4. **Row interaction:** click opens **right sheet** (drawer) with summary, redacted JSON blocks, future actions (copy cURL, replay gated).

### Synthflow Voice Monitor

- Same table-in-card pattern; columns: time, from, to, `lookup_status`, `known_caller`, `matched_by`, `contact_id_ghl` (extend per product spec).

### Clients / Review / Flags / Settings

- Card-based sections and tables as appropriate; keep density **operational**, not CRM-heavy.

---

## Visual system (current implementation)

**Typography**

- **Sans:** Geist (Next `next/font`) — UI and tables.
- **Mono:** Geist Mono — IDs, timestamps, JSON snippets.

**Color**

- shadcn **neutral** theme with **OKLCH CSS variables** in `src/app/globals.css`.
- **Status chips (webhook):** semantic mapping — `queued` blue-tinted surface, `processed` green-tinted, `skipped` amber, `failed` destructive.
- **Env badge:** `PRODUCTION` amber outline; `STAGING` blue outline; `DEVELOPMENT` muted.

**Shape**

- Cards: `rounded-xl`, ring `ring-foreground/10` (from shadcn Card).
- **Radius token:** `--radius` / `--radius-md` aligned for compact controls (buttons).

**Motion**

- `tailwindcss-animate` for menu/sheet enter/exit (shadcn base-ui primitives).

---

## Spacing & density

- Page vertical rhythm: **32px** (`space-y-8`) between major sections on Command Center; **24px** (`space-y-6`) on monitor pages.
- Table cell text: **sm / xs** for IDs; keep **tabular nums** for counts and durations.
- Avoid excessive vertical padding inside table rows; target **~40px** row height for scanability.

---

## Figma deltas (fill after MCP / handoff)

_Use this subsection to record deviations or precise numbers from Figma once frames are read._

| Token / pattern | Figma value | Code location | Notes |
|-----------------|-------------|----------------|-------|
| Sidebar width | _TBD_ | `dashboard-shell.tsx` | Currently `w-[240px]` |
| Content padding | _TBD_ | `dashboard-shell.tsx` | Currently `p-6` |
| Table header style | _TBD_ | `table.tsx` / page wrappers | |
| Status colors | _TBD_ | `webhook-monitor-table.tsx` | |

---

## Environment variables (admin app only)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SA360_ENV` | `staging` \| `production` \| unset → development badge |
| `NEXT_PUBLIC_API_BASE_URL` | Fastify API origin when admin REST routes exist |

Never commit secrets. Do not prefix sensitive keys with `NEXT_PUBLIC_`.

---

## Changelog

- **Initial:** Next.js app shell, sidebar + header, env badge, route stubs, webhook table mock + detail sheet, CSS variables compatible with Tailwind 3 + shadcn components (no `shadcn` CLI package at runtime).
