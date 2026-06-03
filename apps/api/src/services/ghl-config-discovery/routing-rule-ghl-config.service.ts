import type { Prisma } from "@prisma/client";
import type { RoutingRuleGhlConfigBody } from "../../schemas/ghl-config.schema.js";
import { findCampaignRoutingRuleById } from "../../repositories/campaign-routing-rule.repository.js";
import { findGhlLocationConnectionByLocationId } from "../../repositories/ghl-location-connection.repository.js";
import { updateCampaignRoutingRuleDeliveryConfig } from "../../repositories/campaign-routing-rule.repository.js";
import { GHL_CONNECTION_CONNECTED } from "../../lib/delivery-readiness-status.js";
import { evaluateDeliveryReadiness } from "../delivery-readiness.service.js";
import {
  mergeRuleForAssessment,
  persistedReadinessAfterAssessment,
  presentRoutingRuleWithReadiness,
  ruleToReadinessInput,
  type RoutingRuleWithReadinessItem,
} from "../delivery-readiness-admin.present.js";
import { findLatestGhlLocationConfigSnapshot } from "../../repositories/ghl-location-config-snapshot.repository.js";
import { snapshotToDiscoveryResult } from "./ghl-config-discovery.present.js";
import { detectSa360RequiredCustomFields } from "./ghl-config-discovery.service.js";
import type { GhlDiscoveredCustomField } from "./ghl-config-discovery.types.js";

export type SaveRoutingRuleGhlConfigResult =
  | { item: RoutingRuleWithReadinessItem; discoverySummary: Record<string, unknown> | null }
  | { notFound: true }
  | { error: string; code: "LOCATION_MISMATCH" | "NOT_CONNECTED" | "VALIDATION" };

function trimOrNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

export async function getRoutingRuleGhlConfigSummary(ruleId: string) {
  const rule = await findCampaignRoutingRuleById(ruleId.trim());
  if (!rule) return { notFound: true as const };

  const locationId = trimOrNull(rule.destinationSubaccountIdGhl);
  let discoverySummary: Record<string, unknown> | null = null;
  if (locationId) {
    const snap = await findLatestGhlLocationConfigSnapshot(locationId);
    if (snap) {
      const fields = detectSa360RequiredCustomFields(
        (snap.customFieldsJson as GhlDiscoveredCustomField[]) ?? []
      );
      const d = snapshotToDiscoveryResult(snap, fields);
      discoverySummary = {
        fetchedAt: d.fetchedAt,
        pipelineCount: d.pipelines.length,
        workflowCount: d.workflows.length,
        requiredFieldsInstalled: d.requiredFields.requiredFieldsInstalled,
        missingRequiredFields: d.requiredFields.missingRequiredFields,
      };
    }
  }

  return {
    rule: {
      id: rule.id,
      clientAccountId: rule.clientAccountId,
      destinationSubaccountIdGhl: rule.destinationSubaccountIdGhl,
      destinationPipelineIdGhl: rule.destinationPipelineIdGhl,
      destinationPipelineStageIdGhl: rule.destinationPipelineStageIdGhl,
      destinationWorkflowIdGhl: rule.destinationWorkflowIdGhl,
      defaultAssignedUserIdGhl: rule.defaultAssignedUserIdGhl,
      snapshotInstalled: rule.snapshotInstalled,
      requiredFieldsInstalled: rule.requiredFieldsInstalled,
      ghlConnectionStatus: rule.ghlConnectionStatus,
    },
    discoverySummary,
  };
}

export function checkRoutingRuleGhlLocationMismatch(
  ruleLocation: string | null,
  locationId: string,
  confirmLocationMismatch?: boolean
): { error: string; code: "LOCATION_MISMATCH" } | null {
  const trimmed = locationId.trim();
  if (ruleLocation && ruleLocation !== trimmed && confirmLocationMismatch !== true) {
    return {
      error: `locationId ${trimmed} does not match rule destinationSubaccountIdGhl ${ruleLocation}. Set confirmLocationMismatch: true to override.`,
      code: "LOCATION_MISMATCH",
    };
  }
  return null;
}

export async function saveRoutingRuleGhlConfig(
  ruleId: string,
  body: RoutingRuleGhlConfigBody
): Promise<SaveRoutingRuleGhlConfigResult> {
  const existing = await findCampaignRoutingRuleById(ruleId.trim());
  if (!existing) return { notFound: true };

  const locationId = body.locationId.trim();
  const ruleLocation = trimOrNull(existing.destinationSubaccountIdGhl);
  const mismatch = checkRoutingRuleGhlLocationMismatch(
    ruleLocation,
    locationId,
    body.confirmLocationMismatch
  );
  if (mismatch) return mismatch;

  const connection = await findGhlLocationConnectionByLocationId(locationId);
  if (!connection || connection.connectionStatus === "revoked") {
    return {
      error: "No connected GHL OAuth location for this locationId.",
      code: "NOT_CONNECTED",
    };
  }

  const ghlStatus =
    connection.connectionStatus === "connected"
      ? GHL_CONNECTION_CONNECTED
      : connection.connectionStatus;

  const merged = mergeRuleForAssessment(existing, {
    destinationPipelineIdGhl: body.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl: body.destinationPipelineStageIdGhl,
    destinationWorkflowIdGhl: body.destinationWorkflowIdGhl,
    defaultAssignedUserIdGhl: body.defaultAssignedUserIdGhl,
    snapshotInstalled: body.snapshotInstalled,
    requiredFieldsInstalled: body.requiredFieldsInstalled,
    ghlConnectionStatus: ghlStatus,
  });
  if (!ruleLocation) {
    merged.destinationSubaccountIdGhl = locationId;
  }

  const assessment = evaluateDeliveryReadiness(merged);

  const data: Prisma.CampaignRoutingRuleUpdateInput = {
    destinationPipelineIdGhl: trimOrNull(body.destinationPipelineIdGhl),
    destinationPipelineStageIdGhl: trimOrNull(body.destinationPipelineStageIdGhl),
    destinationWorkflowIdGhl: trimOrNull(body.destinationWorkflowIdGhl),
    defaultAssignedUserIdGhl: trimOrNull(body.defaultAssignedUserIdGhl),
    ghlConnectionStatus: ghlStatus,
    ...persistedReadinessAfterAssessment(assessment),
  };
  if (body.snapshotInstalled !== undefined) {
    data.snapshotInstalled = body.snapshotInstalled;
  }
  if (body.requiredFieldsInstalled !== undefined) {
    data.requiredFieldsInstalled = body.requiredFieldsInstalled;
  }
  if (!ruleLocation) {
    data.destinationSubaccountIdGhl = locationId;
  }

  const updated = await updateCampaignRoutingRuleDeliveryConfig(existing.id, data);
  const item = presentRoutingRuleWithReadiness(updated);

  const snap = await findLatestGhlLocationConfigSnapshot(locationId);
  const discoverySummary = snap
    ? {
        fetchedAt: snap.fetchedAt.toISOString(),
        locationName: snap.locationName,
      }
    : null;

  return { item, discoverySummary };
}

export function ruleReadinessPreview(ruleId: string) {
  return findCampaignRoutingRuleById(ruleId).then((rule) =>
    rule ? evaluateDeliveryReadiness(ruleToReadinessInput(rule)) : null
  );
}
