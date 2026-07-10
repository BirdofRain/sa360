import test from "node:test";
import assert from "node:assert/strict";

import { runLf2GhlDuplicateSearchForSourceLead } from "./lf2-ghl-duplicate-search.service.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { findSourceLeadEventById } from "../../repositories/source-lead-event.repository.js";

const baseEvent = {
  id: "evt_1",
  sourceLeadUid: "lead_1",
  clientAccountIdResolved: "smart_agent_360_demo_2",
  normalizedPayloadJson: {
    contact: {
      phone_e164: "+15551234567",
      email: "lead@example.com",
      state: "Texas",
    },
  },
};

test("returns unable_to_verify when identity is missing", async () => {
  const result = await runLf2GhlDuplicateSearchForSourceLead("evt_1", undefined, {
    findSourceLeadEventById: (async () => ({
      ...baseEvent,
      normalizedPayloadJson: { contact: { state: "Texas" } },
    })) as unknown as typeof findSourceLeadEventById,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.summary.classification, "unable_to_verify");
    assert.equal(result.summary.reasonCode, "missing_identity");
  }
});

test("uses authoritative destination and OAuth token without global location fallback", async () => {
  let searchedLocation: string | null = null;
  const result = await runLf2GhlDuplicateSearchForSourceLead("evt_1", undefined, {
    findSourceLeadEventById: (async () => baseEvent) as unknown as typeof findSourceLeadEventById,
    findClientAccountById: (async () => ({
      clientAccountId: "smart_agent_360_demo_2",
      ghlDestination: { destinationSubaccountIdGhl: "VPuMIhN6JpxdoXvvlekZ" },
    })) as unknown as typeof findClientAccountById,
    resolveAccessToken: async (locationId) => {
      assert.equal(locationId, "VPuMIhN6JpxdoXvvlekZ");
      return { accessToken: "oauth-token", authMode: "oauth", locationId };
    },
    searchContacts: async (input) => {
      searchedLocation = input.locationId;
      assert.equal(input.accessToken, "oauth-token");
      return { kind: "not_found", matchCount: 0 };
    },
  });

  assert.equal(searchedLocation, "VPuMIhN6JpxdoXvvlekZ");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.summary.classification, "no_duplicate_found");
    assert.equal(result.summary.destinationSubaccountIdGhl, "VPuMIhN6JpxdoXvvlekZ");
  }
});

test("classifies single match as existing_contact_safe_for_reviewed_update", async () => {
  const result = await runLf2GhlDuplicateSearchForSourceLead("evt_1", undefined, {
    findSourceLeadEventById: (async () => baseEvent) as unknown as typeof findSourceLeadEventById,
    findClientAccountById: (async () => ({
      clientAccountId: "smart_agent_360_demo_2",
      ghlDestination: { destinationSubaccountIdGhl: "loc_1" },
    })) as unknown as typeof findClientAccountById,
    resolveAccessToken: async () => ({
      accessToken: "oauth-token",
      authMode: "oauth",
      locationId: "loc_1",
    }),
    searchContacts: async () => ({
      kind: "matched",
      matchCount: 1,
      contact: {
        contactIdGhl: "ghl_contact_1",
        firstName: "Jane",
        lastName: "Doe",
        displayName: "Jane Doe",
        email: "",
        state: "",
        assignedAgentName: "",
        lifecycleStage: "",
        appointmentStatus: "",
        policyStatus: "",
      },
    }),
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.summary.classification, "existing_contact_safe_for_reviewed_update");
    assert.equal(result.summary.matchedContactIdGhl, "ghl_contact_1");
  }
});

test("ambiguous matches default to unable_to_verify", async () => {
  const result = await runLf2GhlDuplicateSearchForSourceLead("evt_1", undefined, {
    findSourceLeadEventById: (async () => baseEvent) as unknown as typeof findSourceLeadEventById,
    findClientAccountById: (async () => ({
      clientAccountId: "smart_agent_360_demo_2",
      ghlDestination: { destinationSubaccountIdGhl: "loc_1" },
    })) as unknown as typeof findClientAccountById,
    resolveAccessToken: async () => ({
      accessToken: "oauth-token",
      authMode: "oauth",
      locationId: "loc_1",
    }),
    searchContacts: async () => ({ kind: "ambiguous", matchCount: 3 }),
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.summary.classification, "unable_to_verify");
    assert.equal(result.summary.reasonCode, "ambiguous_phone_matches");
  }
});

test("missing destination returns unable_to_verify", async () => {
  const result = await runLf2GhlDuplicateSearchForSourceLead("evt_1", undefined, {
    findSourceLeadEventById: (async () => baseEvent) as unknown as typeof findSourceLeadEventById,
    findClientAccountById: (async () => ({
      clientAccountId: "smart_agent_360_demo_2",
      ghlDestination: null,
    })) as unknown as typeof findClientAccountById,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.summary.classification, "unable_to_verify");
    assert.equal(result.summary.reasonCode, "missing_destination");
  }
});
