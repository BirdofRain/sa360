/**
 * Tag-trigger collision audit.
 *
 * Direct API enrollment does not prove that posting SA360::NICHE::* or
 * SA360::CAMPAIGN::* is safe. A Contact Tag Added listener on those tags, or
 * on the legacy entry tags, can still start an automation. Missing trigger
 * metadata is UNKNOWN. UNKNOWN and CONFLICT withhold attribution tags.
 * This function does not remove tags and does not call GoHighLevel.
 */

import { AUTOMATION_ENTRY_EVENT_TAG } from "../ghl-delivery-adapter/vet-ghl-delivery-contract.js";
import {
  WORKFLOW_AI_READY_TAG,
  WORKFLOW_TRIGGER_TAG,
} from "../ghl-delivery-adapter/ghl-workflow-trigger-mode.js";
import type { TagTriggerCollision } from "./plan-campaign-ghl-delivery.js";

export const CAMPAIGN_ATTRIBUTION_TAG_PREFIXES = ["SA360::NICHE::", "SA360::CAMPAIGN::"] as const;

export const LEGACY_AUTOMATION_ENTRY_TAGS = [
  WORKFLOW_TRIGGER_TAG,
  WORKFLOW_AI_READY_TAG,
  AUTOMATION_ENTRY_EVENT_TAG,
] as const;

export type DiscoveredWorkflowTrigger = {
  type: string | null;
  filters: readonly string[];
};

export type TagAuditWorkflow = {
  id: string;
  triggers: readonly DiscoveredWorkflowTrigger[] | null;
};

export type TagTriggerAudit = {
  outcome: TagTriggerCollision;
  directApiEnrollmentEliminatesCollisions: false;
  attributionTagsInspected: true;
  legacyEntryTagsInspected: true;
  matchedFilters: readonly string[];
  legacyEntryListener: boolean;
  removesExistingTags: false;
};

export function auditCampaignTagTriggers(input: {
  triggerInspectionComplete: boolean;
  workflows: readonly TagAuditWorkflow[];
  attributionTags: readonly string[];
}): TagTriggerAudit {
  const watched = new Set(
    [...CAMPAIGN_ATTRIBUTION_TAG_PREFIXES, ...input.attributionTags, ...LEGACY_AUTOMATION_ENTRY_TAGS].map((tag) =>
      tag.toUpperCase()
    )
  );
  const matched: string[] = [];
  let legacyEntryListener = false;
  let triggersMissing = input.triggerInspectionComplete !== true || input.workflows.length === 0;

  for (const workflow of input.workflows) {
    if (!workflow.triggers) {
      triggersMissing = true;
      continue;
    }
    for (const trigger of workflow.triggers) {
      const type = trigger.type?.trim().toLowerCase() ?? "";
      if (type === "contact_created" || type === "contact created" || type === "customer_created") {
        legacyEntryListener = true;
        matched.push(trigger.type ?? "contact_created");
      }
      for (const filter of trigger.filters) {
        const token = filter.trim();
        if (!token) continue;
        const upper = token.toUpperCase();
        if (
          LEGACY_AUTOMATION_ENTRY_TAGS.some((tag) => upper.includes(tag)) ||
          upper.includes("SA360::NICHE::") ||
          upper.includes("SA360::CAMPAIGN::") ||
          [...watched].some((tag) => tag.startsWith("SA360::") && upper.includes(tag))
        ) {
          matched.push(token);
        }
        if (LEGACY_AUTOMATION_ENTRY_TAGS.some((tag) => upper.includes(tag))) legacyEntryListener = true;
      }
    }
  }

  const attributionHit = matched.some(
    (token) => token.toUpperCase().includes("SA360::NICHE::") || token.toUpperCase().includes("SA360::CAMPAIGN::")
  );
  const outcome: TagTriggerCollision = attributionHit ? "CONFLICT" : triggersMissing ? "UNKNOWN" : "SAFE";
  return {
    outcome,
    directApiEnrollmentEliminatesCollisions: false,
    attributionTagsInspected: true,
    legacyEntryTagsInspected: true,
    matchedFilters: [...new Set(matched)],
    legacyEntryListener,
    removesExistingTags: false,
  };
}
