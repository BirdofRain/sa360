import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClientGhlDestination } from "@prisma/client";

import { normalizeLeadCaptureIoWebhookToLifecyclePayload } from "../source-intake/leadcapture-io-normalizer.js";
import { buildSourceEnrichmentDeliveryContext } from "../source-intake/source-enrichment.service.js";
import { CONFIRMED_JULIA_DODGE_PARENT_URL_KEY } from "../source-intake/source-field-alias.registry.js";
import type { GhlAdapterPlanContext } from "./ghl-delivery-adapter.types.js";
import { executeLiveCanaryGhlSteps } from "./ghl-live-canary-executor.service.js";
import { recordedGhlSourceEnrichment } from "./ghl-live-canary.service.js";
import type { GhlLiveHttpDeps } from "./ghl-live-transport.js";
import {
  enableLiveCanaryRuntimeForTests,
  resetDeliveryRuntimeTestState,
} from "../../test/delivery-runtime-mode-test-helpers.js";

const SUBMITTED_AT = "2026-11-02T18:00:00.000Z";

test.afterEach(() => {
  resetDeliveryRuntimeTestState();
});

function juliaPayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    sa360_route_key: "LCIO_NEXTGEN_VET_SYNTHETIC",
    lead_id: "11111111-2222-4333-8444-555555555555",
    submitted_at: SUBMITTED_AT,
    parent_url: `https://${CONFIRMED_JULIA_DODGE_PARENT_URL_KEY}`,
    first_name: "Pat",
    last_name: "Sample",
    email: "pat.sample@example.test",
    phone: "+15550101955",
    state: "OH",
    zip: "02139",
    ...extra,
  };
}

function productionContext(
  normalized: ReturnType<typeof normalizeLeadCaptureIoWebhookToLifecyclePayload>
): GhlAdapterPlanContext["sourceEnrichment"] {
  const destination = {
    sourceAttributeFieldMapJson: {
      age: { ghlFieldKey: "agefield1", requirement: "optional" },
      date_of_birth: { ghlFieldKey: "dobfield1", requirement: "optional" },
    },
  } as unknown as ClientGhlDestination;
  const delivery = buildSourceEnrichmentDeliveryContext(normalized, destination, null);
  return recordedGhlSourceEnrichment(delivery, normalized, SUBMITTED_AT);
}

function planContext(sourceEnrichment: GhlAdapterPlanContext["sourceEnrichment"]): GhlAdapterPlanContext {
  const now = new Date();
  return {
    plan: {
      id: "plan_recorded_stamp",
      routingDryRunDecisionId: "dec_recorded",
      masterClientAccountId: "master_1",
      sourceLeadUid: "lead_recorded",
      sourceContactIdGhl: null,
      sourcePhoneE164: "+15550101955",
      sourceEmail: "pat.sample@example.test",
      destinationClientAccountId: "client_dest",
      destinationSubaccountIdGhl: "loc_dest",
      destinationClientDisplayName: null,
      nicheKey: "vet",
      productType: null,
      deliveryMode: "live_canary",
      status: "planned",
      planVersion: "1.0",
      generatedAt: now,
      generatedBy: "association_intake",
      summary: null,
      warnings: null,
      lifecycleEventId: null,
      createdAt: now,
      updatedAt: now,
      steps: [
        {
          id: "step_contact",
          deliveryPlanId: "plan_recorded_stamp",
          stepOrder: 1,
          stepType: "create_or_update_contact",
          status: "planned",
          title: "Contact",
          description: null,
          targetSystem: "ghl",
          targetId: null,
          requestPreviewJson: {
            contact: { firstName: "Pat", lastName: "Sample", email: "pat.sample@example.test", phone: "+15550101955" },
          },
          resultPreviewJson: null,
          warnings: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    },
    rule: {
      id: "rule_recorded",
      destinationWorkflowIdGhl: null,
      destinationPipelineIdGhl: null,
      destinationPipelineStageIdGhl: null,
      defaultAssignedUserIdGhl: null,
      opportunityCreationEnabled: false,
    } as GhlAdapterPlanContext["rule"],
    destinationFieldMapping: {
      sa360CustomFieldIdMapJson: {},
      customFieldStampRequired: false,
      ownerAssignmentRequired: false,
      workflowStartRequired: false,
      workflowTriggerMode: "none",
      discoveredCustomFields: [
        { id: "dobfield1", name: "DOB", key: "contact.dob", fieldKey: "contact.dob", dataType: "DATE" },
        { id: "agefield1", name: "Age", key: "contact.age", fieldKey: "contact.age", dataType: "TEXT" },
      ],
    },
    sourceEnrichment,
  };
}

async function stampedValues(ctx: GhlAdapterPlanContext): Promise<Record<string, string>> {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  const prevFieldMap = process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON;
  process.env.GHL_DELIVERY_ADAPTER_MAX_MODE = "live_canary";
  delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  delete process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON;
  enableLiveCanaryRuntimeForTests();
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";
  const values: Record<string, string> = {};
  const deps: GhlLiveHttpDeps = {
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/contacts/upsert") && method === "POST") {
        return new Response(JSON.stringify({ contact: { id: "contact_recorded_stamp" } }), { status: 200 });
      }
      if (method === "PUT" && url.includes("/contacts/") && typeof init?.body === "string") {
        const body = JSON.parse(init.body) as { customFields?: Array<{ id?: string; field_value?: string }> };
        for (const field of body.customFields ?? []) {
          if (field.id && field.field_value) values[field.id] = field.field_value;
        }
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };
  try {
    const result = await executeLiveCanaryGhlSteps(ctx, "idem_recorded_stamp", deps, {
      emitLifecycle: async () => {},
    });
    assert.equal(result.stepOutcomes.find((step) => step.stepType === "stamp_source_attributes")?.status, "succeeded");
    return values;
  } finally {
    if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
    else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
    if (prevToken !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevToken;
    else delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
    if (prevFieldMap !== undefined) process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON = prevFieldMap;
    else delete process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON;
  }
}

test("ordinary GHL delivery stamps projected age and canonical DOB from the lifecycle payload", async () => {
  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(juliaPayload({ date: "03/13/1955" }), {
    receivedAt: SUBMITTED_AT,
  });
  const enrichment = productionContext(normalized);
  assert.equal(enrichment?.normalizedPayload, normalized);
  const derived = await stampedValues(planContext(enrichment));
  assert.equal(derived.agefield1, "71");
  assert.equal(derived.dobfield1, "1955-03-13");

  const suppliedPayload = structuredClone(normalized);
  suppliedPayload.lead_details = {
    ...suppliedPayload.lead_details,
    consumer_age: "40",
    consumer_age_provenance: "supplied",
    consumer_age_conflict: true,
  };
  const supplied = await stampedValues(planContext(productionContext(suppliedPayload)));
  assert.equal(supplied.agefield1, "40");
  assert.equal(supplied.dobfield1, "1955-03-13");
});

test("intake and recorded GHL delivery pass the lifecycle payload into the shared stamp context", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../");
  const persist = readFileSync(resolve(root, "apps/api/src/services/source-intake/source-intake-routing-persist.ts"), "utf8");
  const recorded = readFileSync(resolve(root, "apps/api/src/services/ghl-delivery-adapter/ghl-live-canary.service.ts"), "utf8");
  const association = readFileSync(resolve(root, "apps/api/src/services/association-ongoing-delivery.ts"), "utf8");
  assert.match(persist, /deliverConfirmedAssociationIfActivated\(\{[\s\S]*lifecyclePayload: normalizedWithEnrichment/);
  assert.match(association, /lifecyclePayload: request\.lifecyclePayload/);
  assert.equal(recorded.match(/await sourceEnrichmentPlanContext\(/g)?.length, 2);
  assert.match(recorded, /return recordedGhlSourceEnrichment\(/);
});
