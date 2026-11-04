/**
 * Read-only VET write plan for Admin C.O.C.
 * Uses the live contact, stamp, note, and enrollment functions. It does not
 * send, enroll, or enable delivery.
 */
import type { GhlDiscoveredCustomField } from "../ghl-config-discovery/ghl-config-discovery.types.js";
import {
  buildSourceAttributeStampPlan,
  type SourceAttributeStampPlan,
} from "../source-intake/source-attribute-stamp.service.js";
import type { SourceAttributes, SourceFieldRequirement } from "../source-intake/source-enrichment.types.js";
import { ONBOARDING_LEAD_NOTE_CONTRACT } from "./onboarding-lead-note.js";
import {
  AUTOMATION_ENTRY_EVENT_TAG,
  planIntakeSummaryNote,
  planRoutingTagPreview,
  presentNativeContactPlan,
  vetNativeContactFields,
  workflowEnrollmentAllowed,
  type RoutingTagPreview,
  type VetNativeFieldPlan,
} from "./vet-ghl-delivery-contract.js";

export type VetCustomFieldDisposition =
  | "send"
  | "omitted_missing"
  | "unmapped"
  | "invalid"
  | "blocked"
  | "unavailable";

export type VetCustomFieldPlanRow = {
  key: string;
  fieldId: string | null;
  fieldName: string | null;
  disposition: VetCustomFieldDisposition;
  value: string | null;
};

export type VetWritePlan = {
  native: VetNativeFieldPlan;
  customFields: VetCustomFieldPlanRow[];
  collisions: SourceAttributeStampPlan["collisions"];
  enrollment: { allowed: boolean; reason: string | null };
  automationEntry: {
    tag: RoutingTagPreview["automationEntry"]["tag"];
    disposition: RoutingTagPreview["automationEntry"]["disposition"];
    includedInThisPreviewPost: false;
    detail: string;
  };
  note: {
    enabled: boolean;
    contractVersion: typeof ONBOARDING_LEAD_NOTE_CONTRACT;
    preview: string | null;
    error: string | null;
    posted: false;
  };
  sendsLead: false;
};

function trimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

function fieldByToken(
  fields: readonly GhlDiscoveredCustomField[],
  token: string
): GhlDiscoveredCustomField | null {
  const needle = token.trim();
  if (!needle) return null;
  return (
    fields.find((field) => field.id === needle || field.fieldKey === needle || field.key === needle) ??
    fields.find(
      (field) =>
        field.fieldKey?.toLowerCase() === needle.toLowerCase() || field.key?.toLowerCase() === needle.toLowerCase()
    ) ??
    null
  );
}

export function presentVetWritePlan(input: {
  native: Parameters<typeof vetNativeContactFields>[0];
  sourceAttributes?: Record<string, unknown> | null;
  fieldMap?: Record<string, { ghlFieldKey?: string | null; requirement?: string | null }>;
  discoveredFields?: readonly GhlDiscoveredCustomField[];
  ignoredCanonicalKeys?: readonly string[];
  notesEnabled?: boolean;
  noteEvent?: {
    sourceLeadEventId: string;
    clientAccountId?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    email?: string | null;
    state?: string | null;
    leadType?: string | null;
    generatedAt?: string | null;
  } | null;
}): VetWritePlan {
  const discovered = input.discoveredFields ?? [];
  const fieldMap = input.fieldMap ?? {};
  const attributes = (input.sourceAttributes ?? {}) as SourceAttributes;
  const requirementOf = (value: string | null | undefined): SourceFieldRequirement | undefined =>
    value === "delivery_required" || value === "automation_required" || value === "optional" || value === "ignored"
      ? value
      : undefined;
  const stamp = buildSourceAttributeStampPlan({
    sourceAttributes: attributes,
    fieldMap: Object.fromEntries(
      Object.entries(fieldMap).map(([key, entry]) => [
        key,
        {
          ghlFieldKey: entry.ghlFieldKey?.trim() ?? "",
          requirement: requirementOf(entry.requirement),
        },
      ])
    ),
    discoveredFields: [...discovered],
    ignoredCanonicalKeys: input.ignoredCanonicalKeys ? [...input.ignoredCanonicalKeys] : undefined,
    normalizedPayload: input.native.normalizedPayload,
    receivedAt: input.native.receivedAt,
  });
  const collided = new Map(stamp.collisions.flatMap((collision) => collision.canonicalKeys.map((key) => [key, collision] as const)));
  const customFields: VetCustomFieldPlanRow[] = [];
  const seen = new Set<string>();

  for (const [key, entry] of Object.entries(fieldMap)) {
    seen.add(key);
    const token = entry.ghlFieldKey?.trim() ?? "";
    const discoveredField = token ? fieldByToken(discovered, token) : null;
    const collision = collided.get(key);
    if (collision) {
      customFields.push({
        key,
        fieldId: collision.fieldId,
        fieldName: collision.fieldName,
        disposition: "blocked",
        value: null,
      });
      continue;
    }
    if (stamp.mappableKeys.includes(key)) {
      customFields.push({
        key,
        fieldId: stamp.idMap[key] ?? discoveredField?.id ?? null,
        fieldName: discoveredField?.name ?? null,
        disposition: "send",
        value: stamp.valuesByLogicalKey[key] ?? null,
      });
      continue;
    }
    if (stamp.missingSourceKeys.includes(key)) {
      const raw = trimmed(attributes[key as keyof SourceAttributes]);
      const invalid = key === "date_of_birth" && raw !== null;
      customFields.push({
        key,
        fieldId: discoveredField?.id ?? null,
        fieldName: discoveredField?.name ?? null,
        disposition: invalid ? "invalid" : "omitted_missing",
        value: null,
      });
      continue;
    }
    if (!token) {
      customFields.push({ key, fieldId: null, fieldName: null, disposition: "unmapped", value: null });
      continue;
    }
    if (!discoveredField) {
      customFields.push({ key, fieldId: token, fieldName: null, disposition: "unavailable", value: null });
      continue;
    }
    customFields.push({
      key,
      fieldId: discoveredField.id,
      fieldName: discoveredField.name,
      disposition: "unmapped",
      value: null,
    });
  }

  for (const [key, value] of Object.entries(attributes)) {
    if (seen.has(key) || !trimmed(value)) continue;
    customFields.push({ key, fieldId: null, fieldName: null, disposition: "unmapped", value: trimmed(value) });
  }

  const enrollment = workflowEnrollmentAllowed({
    contactCompleted: true,
    requiredCustomFieldStampFailed: false,
    collisions: stamp.collisions,
    unresolvedDeliveryRequired: stamp.unresolvedDeliveryRequired,
  });
  const routingTags = planRoutingTagPreview({
    locationId: "",
    tags: [AUTOMATION_ENTRY_EVENT_TAG],
    blockAutomationEntry: !enrollment.allowed,
  });

  const notesEnabled = input.notesEnabled === true;
  let note: VetWritePlan["note"] = {
    enabled: false,
    contractVersion: ONBOARDING_LEAD_NOTE_CONTRACT,
    preview: null,
    error: null,
    posted: false,
  };
  if (notesEnabled && input.noteEvent?.sourceLeadEventId.trim()) {
    const planned = planIntakeSummaryNote({
      enabled: true,
      sourceLeadEventId: input.noteEvent.sourceLeadEventId,
      clientAccountId: input.noteEvent.clientAccountId,
      firstName: input.noteEvent.firstName,
      lastName: input.noteEvent.lastName,
      phone: input.noteEvent.phone,
      email: input.noteEvent.email,
      state: input.noteEvent.state,
      leadType: input.noteEvent.leadType,
      sourceAttributes: attributes as Record<string, unknown>,
      generatedAt: input.noteEvent.generatedAt,
      idempotencyKey: `preview:${input.noteEvent.sourceLeadEventId}`,
    });
    if (!planned.enabled) {
      note = { ...note, enabled: false };
    } else if ("error" in planned) {
      note = { enabled: true, contractVersion: ONBOARDING_LEAD_NOTE_CONTRACT, preview: null, error: planned.error, posted: false };
    } else {
      note = {
        enabled: true,
        contractVersion: ONBOARDING_LEAD_NOTE_CONTRACT,
        preview: planned.plan.preview ?? planned.plan.body,
        error: null,
        posted: false,
      };
    }
  }

  return {
    native: presentNativeContactPlan(input.native),
    customFields,
    collisions: stamp.collisions,
    enrollment,
    automationEntry: {
      tag: routingTags.automationEntry.tag,
      disposition: routingTags.automationEntry.disposition,
      includedInThisPreviewPost: false,
      detail: routingTags.detail,
    },
    note,
    sendsLead: false,
  };
}
