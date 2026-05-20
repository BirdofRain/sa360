/**
 * Client-facing copy for /portal preview vs live fallback states.
 */

export type PortalPreviewReason = "not_configured" | "live_fetch_failed";

export type PortalFetchFailureKind =
  | "api_unreachable"
  | "unauthorized"
  | "tenant_not_configured"
  | "unknown";

export type PortalFetchFailure = {
  status: number;
  body: string;
};

export type PortalPreviewBannerCopy = {
  /** Blue info strip inside the dashboard shell. */
  previewBanner: string;
  /** Amber warning above shell when live fetch was attempted and failed. */
  warningTitle?: string;
  warningDetail?: string;
};

const PREVIEW_BANNER_NOT_CONFIGURED =
  "Preview dashboard — sample data. Configure the client portal API settings to load live metrics.";

const PREVIEW_BANNER_LIVE_FAILED =
  "Preview dashboard — showing sample data because live metrics could not be loaded.";

const LIVE_WARNING_TITLE = "Live dashboard unavailable";

function safeApiErrorMessage(body: string): string | undefined {
  if (!body.trim()) return undefined;
  try {
    const parsed = JSON.parse(body) as { error?: unknown; hint?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error.trim();
    }
  } catch {
    /* ignore non-JSON bodies */
  }
  return undefined;
}

/** Classify a failed live dashboard fetch without exposing secrets or stack traces. */
export function classifyPortalFetchFailure(
  failure: PortalFetchFailure
): PortalFetchFailureKind {
  const { status, body } = failure;
  const apiError = safeApiErrorMessage(body)?.toLowerCase() ?? "";
  const bodyLower = body.toLowerCase();

  if (status === 401) return "unauthorized";

  if (status === 503) {
    if (
      apiError.includes("tenant") ||
      apiError.includes("client_portal_client_account_id") ||
      bodyLower.includes("tenant not configured")
    ) {
      return "tenant_not_configured";
    }
    if (apiError.includes("disabled")) return "api_unreachable";
    return "tenant_not_configured";
  }

  if (status === 502 || status === 0) return "api_unreachable";

  if (status >= 500) return "api_unreachable";

  return "unknown";
}

export function portalFetchFailureDetail(kind: PortalFetchFailureKind): string {
  switch (kind) {
    case "api_unreachable":
      return "The metrics API could not be reached. Check that the API is running and the URL is correct.";
    case "unauthorized":
      return "The portal API key was rejected. Verify CLIENT_PORTAL_API_KEY matches on the API and this app.";
    case "tenant_not_configured":
      return "The API tenant is not configured. Set CLIENT_PORTAL_CLIENT_ACCOUNT_ID on the API service.";
    default:
      return "An unexpected error occurred while loading live metrics.";
  }
}

export function resolvePortalPreviewBannerCopy(
  reason: PortalPreviewReason,
  failure?: PortalFetchFailure
): PortalPreviewBannerCopy {
  if (reason === "not_configured") {
    return { previewBanner: PREVIEW_BANNER_NOT_CONFIGURED };
  }

  const kind = failure
    ? classifyPortalFetchFailure(failure)
    : ("unknown" as PortalFetchFailureKind);

  return {
    previewBanner: PREVIEW_BANNER_LIVE_FAILED,
    warningTitle: LIVE_WARNING_TITLE,
    warningDetail: portalFetchFailureDetail(kind),
  };
}
