/**
 * Ongoing intake calls generateDirectCanaryDeliveryPlanForDecision without
 * leadIdentity. Phone and email must still land on the plan from the same
 * presenter the admin delivery-plan route uses. An explicit null stays null.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../lib/safe-test-database-url.js";
import { generateDirectCanaryDeliveryPlanForDecision } from "./lead-delivery-plan.service.js";
import { ROUTING_AUTHORITY_SOURCE_ASSOCIATION } from "./routing-source-association.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

const LOCATION_ID = "yCziKRW26eFg8IXAQZ73";
const SNAPSHOT_PHONE = "+15555550199";
const SNAPSHOT_EMAIL = "ongoing.identity@example.test";
const SOURCE_PHONE = "+15555550200";
const SOURCE_EMAIL = "source.identity@example.test";
const EXPLICIT_PHONE = "+15555550201";
const EXPLICIT_EMAIL = "explicit.identity@example.test";

describe(
  "direct canary plans hydrate omitted lead identity",
  { skip: !runIntegration },
  () => {
    let db: PrismaClient;
    const stamp = `${Date.now()}`;
    const clientAccountId = `plan_identity_${stamp}`;
    const planIds: string[] = [];
    const decisionIds: string[] = [];
    const leadIds: string[] = [];

    before(async () => {
      assertSafeTestDatabaseUrl(integrationUrlRaw);
      db = new PrismaClient({ datasources: { db: { url: integrationUrlRaw } } });
      await db.clientAccount.create({
        data: {
          clientAccountId,
          clientDisplayName: "Plan Identity Test",
          status: "onboarding",
        },
      });
      await db.clientGhlDestination.create({
        data: {
          clientAccountId,
          destinationSubaccountIdGhl: LOCATION_ID,
          locationName: "Test Sam CRM",
          destinationWorkflowIdGhl: "d4c1fa4c-a3e2-4fd8-9091-b3fad0d04edd",
          workflowTriggerMode: "direct_api",
          deliveryMode: "shadow",
          deliveryEnabled: false,
          clientCutoverApproved: false,
          snapshotInstalled: false,
          requiredFieldsInstalled: false,
          ghlConnectionStatus: "connected",
          internalApprovalStatus: "not_reviewed",
        },
      });
    });

    after(async () => {
      if (planIds.length > 0) {
        await db.leadDeliveryPlan.deleteMany({ where: { id: { in: planIds } } }).catch(() => undefined);
      }
      if (leadIds.length > 0) {
        await db.sourceLeadEvent.deleteMany({ where: { id: { in: leadIds } } }).catch(() => undefined);
      }
      if (decisionIds.length > 0) {
        await db.routingDryRunDecision
          .deleteMany({ where: { id: { in: decisionIds } } })
          .catch(() => undefined);
      }
      await db.clientAccount.delete({ where: { clientAccountId } }).catch(() => undefined);
      await db.$disconnect();
    });

    async function createDecision(snapshot: Prisma.InputJsonValue, sourceLeadUid: string) {
      const decision = await db.routingDryRunDecision.create({
        data: {
          masterClientAccountId: "lal_master_vet",
          sourceLeadUid,
          matched: true,
          matchedRuleId: null,
          confidence: "confirmed_source",
          matchReason: "Confirmed parent URL association",
          destinationClientAccountId: clientAccountId,
          destinationSubaccountIdGhl: LOCATION_ID,
          routingEventNameInternal: "routing_matched",
          attributionSnapshot: snapshot,
        },
      });
      decisionIds.push(decision.id);
      return decision;
    }

    it("stores snapshot phone and email when the caller omits leadIdentity", async () => {
      const decision = await createDecision(
        {
          routingAuthority: ROUTING_AUTHORITY_SOURCE_ASSOCIATION,
          leadIdentity: {
            leadName: "Casey Fixture",
            firstName: "Casey",
            lastName: "Fixture",
            phone: SNAPSHOT_PHONE,
            email: SNAPSHOT_EMAIL,
            contactIdGhl: null,
          },
        },
        `assoc-snapshot-${stamp}`
      );

      const created = await generateDirectCanaryDeliveryPlanForDecision(decision.id);
      assert.equal("plan" in created, true);
      if (!("plan" in created)) return;
      planIds.push(created.plan.id);
      assert.equal(created.plan.sourcePhoneE164, SNAPSHOT_PHONE);
      assert.equal(created.plan.sourceEmail, SNAPSHOT_EMAIL);

      const contact = created.plan.steps.find((step) => step.stepType === "create_or_update_contact");
      const preview = contact?.requestPreviewJson as { contact?: { phone?: string; email?: string } } | null;
      assert.equal(preview?.contact?.phone, SNAPSHOT_PHONE);
      assert.equal(preview?.contact?.email, SNAPSHOT_EMAIL);
    });

    it("stores source-lead contact phone and email when the snapshot has none", async () => {
      const decision = await createDecision(
        { routingAuthority: ROUTING_AUTHORITY_SOURCE_ASSOCIATION },
        `assoc-source-${stamp}`
      );
      const lead = await db.sourceLeadEvent.create({
        data: {
          sourceLeadUid: decision.sourceLeadUid,
          routingDryRunDecisionId: decision.id,
          sourceProvider: "manual_import",
          sourceSystem: "external_vendor",
          sourceType: "manual_entry",
          rawPayloadJson: { untouched: true },
          status: "routing_matched",
          normalizedPayloadJson: {
            contact: {
              first_name: "Riley",
              last_name: "Fixture",
              phone_e164: SOURCE_PHONE,
              email: SOURCE_EMAIL,
            },
          },
        },
      });
      leadIds.push(lead.id);

      const created = await generateDirectCanaryDeliveryPlanForDecision(decision.id);
      assert.equal("plan" in created, true);
      if (!("plan" in created)) return;
      planIds.push(created.plan.id);
      assert.equal(created.plan.sourcePhoneE164, SOURCE_PHONE);
      assert.equal(created.plan.sourceEmail, SOURCE_EMAIL);
    });

    it("keeps an explicit null identity and an explicit caller identity", async () => {
      const nulled = await createDecision(
        {
          routingAuthority: ROUTING_AUTHORITY_SOURCE_ASSOCIATION,
          leadIdentity: {
            phone: SNAPSHOT_PHONE,
            email: SNAPSHOT_EMAIL,
          },
        },
        `assoc-null-${stamp}`
      );
      const keptNull = await generateDirectCanaryDeliveryPlanForDecision(nulled.id, {
        leadIdentity: null,
      });
      assert.equal("plan" in keptNull, true);
      if (!("plan" in keptNull)) return;
      planIds.push(keptNull.plan.id);
      assert.equal(keptNull.plan.sourcePhoneE164, null);
      assert.equal(keptNull.plan.sourceEmail, null);

      const explicit = await createDecision(
        {
          routingAuthority: ROUTING_AUTHORITY_SOURCE_ASSOCIATION,
          leadIdentity: {
            phone: SNAPSHOT_PHONE,
            email: SNAPSHOT_EMAIL,
          },
        },
        `assoc-explicit-${stamp}`
      );
      const keptExplicit = await generateDirectCanaryDeliveryPlanForDecision(explicit.id, {
        leadIdentity: {
          contactIdGhl: null,
          firstName: "Explicit",
          lastName: "Fixture",
          displayName: "Explicit Fixture",
          phoneE164: EXPLICIT_PHONE,
          email: EXPLICIT_EMAIL,
        },
      });
      assert.equal("plan" in keptExplicit, true);
      if (!("plan" in keptExplicit)) return;
      planIds.push(keptExplicit.plan.id);
      assert.equal(keptExplicit.plan.sourcePhoneE164, EXPLICIT_PHONE);
      assert.equal(keptExplicit.plan.sourceEmail, EXPLICIT_EMAIL);
    });
  }
);
