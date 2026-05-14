/**
 * CSP for the embedded Agent Workspace page (`/agent-workspace`) only.
 *
 * Why here (not next.config `headers`):
 * - `GHL_EMBED_FRAME_ANCESTORS` must be read at **runtime** on App Platform / Docker.
 * - Middleware can attach headers only to the workspace **document** route, not the whole app.
 *
 * Why `frame-ancestors` (not `X-Frame-Options`):
 * - `X-Frame-Options: DENY` or `SAMEORIGIN` blocks GHL parent frames.
 * - A CSP with only `frame-ancestors` allows embedding from an explicit allowlist without legacy XFO.
 *
 * Why not apply to `/api/agent-workspace/*`:
 * - Those responses are `fetch()` targets (JSON), not framed HTML; leaving them without
 *   frame-ancestors avoids confusion and keeps policy minimal.
 *
 * Admin dashboard routes (`/(dashboard)`, `/clients`, etc.) must **not** reuse this policy:
 * - They should not be embeddable in arbitrary third-party iframes (session theft / UI redressing).
 * - This module is only imported from middleware for `/agent-workspace` HTML.
 */

/** Default GHL / LeadConnector app origins (no subdomain wildcards). Tighten with `GHL_EMBED_FRAME_ANCESTORS` if you use a white-label host. */
const DEFAULT_FRAME_ANCESTORS_SOURCES = [
  "'self'",
  "https://app.gohighlevel.com",
  "https://app.leadconnectorhq.com",
].join(" ");

/**
 * Full `Content-Security-Policy` header value: a single `frame-ancestors` directive.
 *
 * `GHL_EMBED_FRAME_ANCESTORS`:
 * - **Unset:** `frame-ancestors 'self' https://app.gohighlevel.com https://app.leadconnectorhq.com`
 * - **Set to source list only:** e.g. `'self' https://app.gohighlevel.com https://agency.example.com`
 * - **Set with directive prefix:** e.g. `frame-ancestors 'self' https://...` (used verbatim)
 */
export function getContentSecurityPolicyForAgentWorkspaceEmbed(): string {
  const raw = process.env.GHL_EMBED_FRAME_ANCESTORS?.trim();
  if (!raw) {
    return `frame-ancestors ${DEFAULT_FRAME_ANCESTORS_SOURCES}`;
  }
  const lower = raw.slice(0, 16).toLowerCase();
  if (lower.startsWith("frame-ancestors")) {
    return raw;
  }
  return `frame-ancestors ${raw}`;
}

export const AGENT_WORKSPACE_EMBED_CSP_HEADER = "Content-Security-Policy" as const;
