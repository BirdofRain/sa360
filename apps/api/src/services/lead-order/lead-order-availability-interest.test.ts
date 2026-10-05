import assert from "node:assert/strict";
import { test } from "node:test";

import type { Prisma } from "@prisma/client";
import { mergeAvailabilityInterestIntoNotes } from "@sa360/shared";

import {
  CLIENT_LEAD_ORDER_INTEREST_REQUIRED,
  approveLeadOrder,
  createClientLeadOrder,
  updateAdminLeadOrder,
} from "./lead-order.service.js";

const readyAccount = async () => ({
  id: "acct_vet",
  status: "active",
  clientDisplayName: "Valley Vet",
});

test("fresh and live transfer requests require interest and stay unfulfillable", async () => {
  const missing = await createClientLeadOrder(
    {
      nicheKey: "vet_fex",
      states: ["TX"],
      leadVolume: 25,
      campaignType: "Fresh leads",
      crmPackage: "lead_delivery",
      aiVoiceAddon: false,
      deliveryDestinationLabel: "Valley Vet",
      notes: "Call after 4",
    },
    "acct_vet",
    {
      findClientAccountByIdImpl: readyAccount as never,
      nextLeadOrderNumberImpl: (async () => "LO-2001") as never,
      createLeadOrderRecordImpl: (async () => {
        throw new Error("should not persist");
      }) as never,
    }
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, CLIENT_LEAD_ORDER_INTEREST_REQUIRED);

  const persisted: { row: Record<string, unknown> | null } = { row: null };
  const notes = mergeAvailabilityInterestIntoNotes("Call after 4", {
    requestedOffering: "live_transfer",
    notifyWhenAvailable: true,
    capturedAt: "2026-10-05T00:00:00.000Z",
  });
  const saved = await createClientLeadOrder(
    {
      nicheKey: "nurse_life",
      states: ["TX"],
      leadVolume: 25,
      campaignType: "Live transfer",
      crmPackage: "lead_delivery",
      aiVoiceAddon: false,
      deliveryDestinationLabel: "Valley Vet",
      notes,
    },
    "acct_vet",
    {
      findClientAccountByIdImpl: readyAccount as never,
      nextLeadOrderNumberImpl: (async () => "LO-2002") as never,
      createLeadOrderRecordImpl: (async (input: Prisma.LeadOrderCreateInput) => {
        persisted.row = input as unknown as Record<string, unknown>;
        return { id: "ord_interest" };
      }) as never,
    }
  );
  assert.equal(saved.ok, true);
  const created = persisted.row;
  assert.ok(created);
  assert.equal(created.status, "submitted");
  assert.equal(created.nicheKey, "nurse");
  assert.equal("orderLines" in created, false);
  assert.match(String(created.adminNotes), /Interest \/ Coming soon/);
  assert.match(String(created.notes), /Call after 4/);
  assert.match(String(created.notes), /sa360\.availabilityInterest\.v1/);
  assert.match(String(created.notes), /live_transfer/);
});

test("interest-only orders cannot be approved or activated", async () => {
  let updated = false;
  const interest = {
    id: "ord_interest",
    status: "submitted",
    paymentConfirmationStatus: "confirmed",
    campaignType: "Fresh leads",
    notes: null,
  };
  const approved = await approveLeadOrder("ord_interest", {
    findLeadOrderByIdImpl: (async () => interest) as never,
    updateLeadOrderRecordImpl: (async () => {
      updated = true;
      return interest;
    }) as never,
  });
  assert.equal(approved.ok, false);
  if (!approved.ok && "error" in approved) {
    assert.equal(approved.error, "availability_interest_only");
  }
  assert.equal(updated, false);

  const activated = await updateAdminLeadOrder(
    "ord_interest",
    { status: "active" },
    {
      findLeadOrderByIdImpl: (async () => ({
        ...interest,
        status: "ready",
        campaignType: "Aged leads",
        notes: mergeAvailabilityInterestIntoNotes("", {
          requestedOffering: "fresh_leads",
          notifyWhenAvailable: true,
          capturedAt: "2026-10-05T00:00:00.000Z",
        }),
      })) as never,
      updateLeadOrderRecordImpl: (async () => {
        updated = true;
        return interest;
      }) as never,
    }
  );
  assert.equal(activated.ok, false);
  if (!activated.ok && "error" in activated) {
    assert.equal(activated.error, "availability_interest_only");
  }
  assert.equal(updated, false);
});

test("aged orders can still be approved", async () => {
  let nextStatus: string | null = null;
  const approved = await approveLeadOrder("ord_aged", {
    findLeadOrderByIdImpl: (async () => ({
      id: "ord_aged",
      status: "submitted",
      paymentConfirmationStatus: "confirmed",
      campaignType: "Aged leads",
      notes: "Need a Monday start",
    })) as never,
    updateLeadOrderRecordImpl: (async (_id: string, patch: Prisma.LeadOrderUpdateInput) => {
      nextStatus = String(patch.status ?? "");
      return { id: "ord_aged", status: "ready" };
    }) as never,
  });
  assert.equal(approved.ok, true);
  assert.equal(nextStatus, "ready");
});
