/**
 * Reusable LeadCapture trust reconciliation job definition.
 * Disabled by default — not enqueued until pilot operators authorize scheduled reconciliation.
 */
import { isLeadCaptureTrustSyncEnabled } from "../../lib/leadcapture-data-api-env.js";

export const LEADCAPTURE_TRUST_RECONCILE_JOB_NAME = "leadcapture_trust_reconcile_pilot";

export function isLeadCaptureTrustReconcileJobEnabled(): boolean {
  return false;
}

export function assertLeadCaptureTrustReconcileJobRunnable(): void {
  if (!isLeadCaptureTrustReconcileJobEnabled() || !isLeadCaptureTrustSyncEnabled()) {
    throw new Error("LeadCapture trust reconcile job is disabled.");
  }
}
