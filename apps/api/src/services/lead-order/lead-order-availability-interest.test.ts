import assert from "node:assert/strict";
import { test } from "node:test";

import type { Prisma } from "@prisma/client";
import { mergeAvailabilityInterestIntoNotes } from "@sa360/shared";

import {
  CLIENT_LEAD_ORDER_AGED_OPTIONS_REQUIRED,
  CLIENT_LEAD_ORDER_INTEREST_REQUIRED,
  CLIENT_LEAD_ORDER_UNSUPPORTED_CAMPAIGN,
  CLIENT_LEAD_ORDER_UNSUPPORTED_NICHE,
  approveLeadOrder,
  createAdminLeadOrder,
  createClientLeadOrder,
  updateAdminLeadOrder,
} from "./lead-order.service.js";

const AGED_OPTIONS_NOTES =
  'Need a Monday start\n---\nsa360.portalAgedOptions.v1 {"requestedAgeBucket":"COMMERCE_1_3_MO","shortfallPolicy":"REFUND_UNFILLED"}';

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
  assert.equal(created.campaignType, "availability_interest:live_transfer");
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
    campaignType: "availability_interest:fresh_leads",
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

test("legacy fresh and live transfer rows are not hard-blocked by campaign type", async () => {
  for (const campaignType of ["Fresh leads", "Live transfer"]) {
    let nextStatus: string | null = null;
    const approved = await approveLeadOrder(`ord_${campaignType}`, {
      findLeadOrderByIdImpl: (async () => ({
        id: `ord_${campaignType}`,
        status: "submitted",
        paymentConfirmationStatus: "confirmed",
        campaignType,
        notes: null,
      })) as never,
      updateLeadOrderRecordImpl: (async (_id: string, patch: Prisma.LeadOrderUpdateInput) => {
        nextStatus = String(patch.status ?? "");
        return { id: "ord_legacy", status: "ready" };
      }) as never,
    });
    assert.equal(approved.ok, true);
    assert.equal(nextStatus, "ready");
  }
});

test("client campaign catalog and commerce niche fail closed", async () => {
  const persist = async () => {
    throw new Error("should not persist");
  };
  const deps = {
    findClientAccountByIdImpl: readyAccount as never,
    nextLeadOrderNumberImpl: (async () => "LO-2099") as never,
    createLeadOrderRecordImpl: persist as never,
  };
  const base = {
    nicheKey: "vet",
    states: ["TX"] as ["TX"],
    leadVolume: 25,
    campaignType: "Aged leads",
    crmPackage: "lead_delivery",
    aiVoiceAddon: false,
    deliveryDestinationLabel: "Valley Vet",
    notes: AGED_OPTIONS_NOTES,
  };

  for (const campaignType of [
    "Fresh-leads",
    "Fresh Lead",
    "Live transfers",
    "Buy now",
    "ppl_aged",
    "availability_interest:fresh_leads",
    "availability_interest:live_transfer",
  ]) {
    const rejected = await createClientLeadOrder({ ...base, campaignType, notes: "Call after 4" }, "acct_vet", deps);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.equal(
        rejected.code,
        campaignType === "Fresh-leads"
          ? CLIENT_LEAD_ORDER_INTEREST_REQUIRED
          : CLIENT_LEAD_ORDER_UNSUPPORTED_CAMPAIGN
      );
    }
  }

  for (const nicheKey of ["HVAC", "mortgage", "unspecified"]) {
    const rejected = await createClientLeadOrder({ ...base, nicheKey }, "acct_vet", deps);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.code, CLIENT_LEAD_ORDER_UNSUPPORTED_NICHE);
  }

  for (const campaignType of ["aged leads", "Aged-leads", "Aged leads"]) {
    const missing = await createClientLeadOrder(
      { ...base, campaignType, notes: "Need a Monday start" },
      "acct_vet",
      deps
    );
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, CLIENT_LEAD_ORDER_AGED_OPTIONS_REQUIRED);
  }

  const persisted: { row: Record<string, unknown> | null } = { row: null };
  const aged = await createClientLeadOrder(
    { ...base, campaignType: "aged leads" },
    "acct_vet",
    {
      ...deps,
      createLeadOrderRecordImpl: (async (input: Prisma.LeadOrderCreateInput) => {
        persisted.row = input as unknown as Record<string, unknown>;
        return { id: "ord_aged_norm" };
      }) as never,
    }
  );
  assert.equal(aged.ok, true);
  assert.equal(persisted.row?.campaignType, "Aged leads");
  assert.equal(persisted.row?.nicheKey, "vet");

  const freshNotes = mergeAvailabilityInterestIntoNotes("Call after 4", {
    requestedOffering: "fresh_leads",
    notifyWhenAvailable: true,
    capturedAt: "2026-10-05T00:00:00.000Z",
  });
  const fresh = await createClientLeadOrder(
    { ...base, nicheKey: "vet_fex", campaignType: "Fresh-leads", notes: freshNotes },
    "acct_vet",
    {
      ...deps,
      createLeadOrderRecordImpl: (async (input: Prisma.LeadOrderCreateInput) => {
        persisted.row = input as unknown as Record<string, unknown>;
        return { id: "ord_fresh" };
      }) as never,
    }
  );
  assert.equal(fresh.ok, true);
  assert.equal(persisted.row?.campaignType, "availability_interest:fresh_leads");
  assert.equal(persisted.row?.nicheKey, "vet");
});

test("admin fresh orders stay legacy campaign types", async () => {
  const persisted: { row: Record<string, unknown> | null } = { row: null };
  const created = await createAdminLeadOrder(
    {
      clientAccountId: "acct_vet",
      nicheKey: "HVAC",
      states: ["TX"],
      leadVolume: 10,
      campaignType: "Fresh leads",
      crmPackage: "lead_delivery",
      aiVoiceAddon: false,
      deliveryDestinationLabel: "Admin desk",
    },
    {
      nextLeadOrderNumberImpl: (async () => "LO-3001") as never,
      createLeadOrderRecordImpl: (async (input: Prisma.LeadOrderCreateInput) => {
        persisted.row = input as unknown as Record<string, unknown>;
        return { id: "ord_admin" };
      }) as never,
    }
  );
  assert.equal(created.ok, true);
  assert.equal(persisted.row?.campaignType, "Fresh leads");
  assert.equal(persisted.row?.nicheKey, "HVAC");
});
