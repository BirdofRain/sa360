const DEFAULT_BASE_URL = "https://my.leadcapture.io/api";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_PAGE_SIZE = 25;
const DEFAULT_MAX_RETRIES = 2;

function parseCsvEnv(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function getLeadCaptureDataApiBaseUrl(): string {
  const raw = process.env.SA360_LEADCAPTURE_DATA_API_BASE_URL?.trim();
  return raw && raw.length > 0 ? raw.replace(/\/+$/g, "") : DEFAULT_BASE_URL;
}

export function getLeadCaptureDataApiToken(): string | null {
  const raw = process.env.SA360_LEADCAPTURE_DATA_API_TOKEN?.trim();
  return raw && raw.length > 0 ? raw : null;
}

export function isLeadCaptureTrustSyncEnabled(): boolean {
  const raw = process.env.SA360_LEADCAPTURE_TRUST_SYNC_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function getLeadCaptureTrustSyncCampaignAllowlist(): string[] {
  return parseCsvEnv(process.env.SA360_LEADCAPTURE_TRUST_SYNC_CAMPAIGN_ALLOWLIST);
}

export function getLeadCaptureTrustSyncFormAllowlist(): string[] {
  return parseCsvEnv(process.env.SA360_LEADCAPTURE_TRUST_SYNC_FORM_ALLOWLIST);
}

export function getLeadCaptureDataApiTimeoutMs(): number {
  return parsePositiveInt(process.env.SA360_LEADCAPTURE_DATA_API_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
}

export function getLeadCaptureDataApiMaxPageSize(): number {
  const configured = parsePositiveInt(
    process.env.SA360_LEADCAPTURE_DATA_API_MAX_PAGE_SIZE,
    DEFAULT_MAX_PAGE_SIZE
  );
  return Math.min(configured, 25);
}

export function getLeadCaptureDataApiMaxRetries(): number {
  return parsePositiveInt(process.env.SA360_LEADCAPTURE_DATA_API_MAX_RETRIES, DEFAULT_MAX_RETRIES);
}

export function isLeadCaptureTrustSyncCampaignAllowed(campaignId: string): boolean {
  const allowlist = getLeadCaptureTrustSyncCampaignAllowlist();
  if (allowlist.length === 0) return false;
  return allowlist.includes(campaignId.trim());
}

export function isLeadCaptureTrustSyncFormAllowed(formId: string | null | undefined): boolean {
  const allowlist = getLeadCaptureTrustSyncFormAllowlist();
  if (allowlist.length === 0) return true;
  if (!formId?.trim()) return false;
  return allowlist.includes(formId.trim());
}

export function collectLeadCaptureTrustSyncBlockers(input: {
  campaignId: string;
  formId?: string | null;
}): string[] {
  const blockers: string[] = [];
  if (!isLeadCaptureTrustSyncEnabled()) {
    blockers.push("SA360_LEADCAPTURE_TRUST_SYNC_ENABLED is false; trust sync is disabled.");
  }
  if (!getLeadCaptureDataApiToken()) {
    blockers.push("SA360_LEADCAPTURE_DATA_API_TOKEN is not configured.");
  }
  if (!isLeadCaptureTrustSyncCampaignAllowed(input.campaignId)) {
    blockers.push("campaign is not in SA360_LEADCAPTURE_TRUST_SYNC_CAMPAIGN_ALLOWLIST.");
  }
  if (!isLeadCaptureTrustSyncFormAllowed(input.formId)) {
    blockers.push("form is not in SA360_LEADCAPTURE_TRUST_SYNC_FORM_ALLOWLIST.");
  }
  return blockers;
}
