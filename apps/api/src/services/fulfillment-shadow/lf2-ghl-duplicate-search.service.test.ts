import test from "node:test";
import assert from "node:assert/strict";

import { runLf2GhlDuplicateSearchForSourceLead } from "./lf2-ghl-duplicate-search.service.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { findSourceLeadEventById } from "../../repositories/source-lead-event.repository.js";
import type { GhlLocationContactSearchResult } from "../ghl-contact-search.service.js";

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

const clientWithDestination = {
  clientAccountId: "smart_agent_360_demo_2",
  ghlDestination: { destinationSubaccountIdGhl: "VPuMIhN6JpxdoXvvlekZ" },
};

const authDeps = {
  resolveAccessToken: async () => ({
    accessToken: "oauth-token",
    authMode: "oauth" as const,
    locationId: "VPuMIhN6JpxdoXvvlekZ",
  }),
};

function contact(id: string, phone = "", email = "") {
  return {
    contactIdGhl: id,
    firstName: "Jane",
    lastName: "Doe",
    displayName: "Jane Doe",
    email,
    phone,
    state: "",
    assignedAgentName: "",
    lifecycleStage: "",
    appointmentStatus: "",
    policyStatus: "",
  };
}

function matched(id: string, phone = "", email = ""): GhlLocationContactSearchResult {
  return { kind: "matched", matchCount: 1, contact: contact(id, phone, email) };
}

function runWithSearch(
  searchContacts: (input: {
    query: string;
    identityType: "phone" | "email";
  }) => Promise<GhlLocationContactSearchResult>,
  event: typeof baseEvent = baseEvent
) {
  return runLf2GhlDuplicateSearchForSourceLead("evt_1", undefined, {
    findSourceLeadEventById: (async () => event) as unknown as typeof findSourceLeadEventById,
    findClientAccountById: (async () => clientWithDestination) as unknown as typeof findClientAccountById,
    ...authDeps,
    searchContacts: async (input) => searchContacts(input),
  });
}

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
    findClientAccountById: (async () => clientWithDestination) as unknown as typeof findClientAccountById,
    resolveAccessToken: async (locationId) => {
      assert.equal(locationId, "VPuMIhN6JpxdoXvvlekZ");
      return { accessToken: "oauth-token", authMode: "oauth", locationId };
    },
    searchContacts: async (input) => {
      searchedLocation = input.locationId;
      assert.equal(input.accessToken, "oauth-token");
      assert.ok(input.identityType === "phone" || input.identityType === "email");
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

test("phone and email both not found returns no_duplicate_found", async () => {
  const result = await runWithSearch(async () => ({ kind: "not_found", matchCount: 0 }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.summary.classification, "no_duplicate_found");
    assert.equal(result.summary.phoneSearchOutcome, "not_found");
    assert.equal(result.summary.emailSearchOutcome, "not_found");
    assert.equal(result.summary.phoneSearchAttempted, true);
    assert.equal(result.summary.emailSearchAttempted, true);
  }
});

test("phone and email match same contact ID returns safe reviewed update", async () => {
  const result = await runWithSearch(async (input) => {
    if (input.identityType === "phone") return matched("ghl_1", "+15551234567");
    return matched("ghl_1", "", "lead@example.com");
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.summary.classification, "existing_contact_safe_for_reviewed_update");
    assert.equal(result.summary.matchedContactIdGhl, "ghl_1");
    assert.equal(result.summary.reasonCode, "phone_and_email_match_same_contact");
  }
});

test("phone and email match different contact IDs returns duplicate_risk", async () => {
  const result = await runWithSearch(async (input) => {
    if (input.identityType === "phone") return matched("ghl_phone", "+15551234567");
    return matched("ghl_email", "", "lead@example.com");
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.summary.classification, "duplicate_risk");
    assert.equal(result.summary.reasonCode, "identity_matches_different_contacts");
    assert.equal(result.summary.matchedContactIdGhl, null);
  }
});

test("phone match and email not found returns duplicate_risk", async () => {
  const result = await runWithSearch(async (input) => {
    if (input.identityType === "phone") return matched("ghl_1", "+15551234567");
    return { kind: "not_found", matchCount: 0 };
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.summary.classification, "duplicate_risk");
    assert.equal(result.summary.reasonCode, "partial_identity_match");
  }
});

test("phone not found and email match returns duplicate_risk", async () => {
  const result = await runWithSearch(async (input) => {
    if (input.identityType === "phone") return { kind: "not_found", matchCount: 0 };
    return matched("ghl_1", "", "lead@example.com");
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.summary.classification, "duplicate_risk");
    assert.equal(result.summary.reasonCode, "partial_identity_match");
  }
});

test("ambiguous phone matches return unable_to_verify", async () => {
  const result = await runWithSearch(async (input) => {
    if (input.identityType === "phone") return { kind: "ambiguous", matchCount: 2 };
    return { kind: "not_found", matchCount: 0 };
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.summary.classification, "unable_to_verify");
    assert.equal(result.summary.reasonCode, "ambiguous_phone_matches");
  }
});

test("ambiguous email matches return unable_to_verify", async () => {
  const result = await runWithSearch(async (input) => {
    if (input.identityType === "phone") return { kind: "not_found", matchCount: 0 };
    return { kind: "ambiguous", matchCount: 2 };
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.summary.classification, "unable_to_verify");
    assert.equal(result.summary.reasonCode, "ambiguous_email_matches");
  }
});

test("phone search error with available email leg returns unable_to_verify", async () => {
  const result = await runWithSearch(async (input) => {
    if (input.identityType === "phone") return { kind: "error" };
    return matched("ghl_1", "", "lead@example.com");
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.summary.classification, "unable_to_verify");
    assert.equal(result.summary.reasonCode, "phone_search_unverifiable");
    assert.equal(result.summary.matchedContactIdGhl, null);
  }
});

test("phone search success with email search error returns unable_to_verify", async () => {
  const result = await runWithSearch(async (input) => {
    if (input.identityType === "phone") return matched("ghl_1", "+15551234567");
    return { kind: "error" };
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.summary.classification, "unable_to_verify");
    assert.equal(result.summary.reasonCode, "email_search_unverifiable");
  }
});

test("phone-only exact match returns safe reviewed update", async () => {
  const result = await runWithSearch(
    async (input) => {
      assert.equal(input.identityType, "phone");
      return matched("ghl_phone_only", "+15551234567");
    },
    {
      ...baseEvent,
      normalizedPayloadJson: { contact: { phone_e164: "+15551234567", state: "Texas" } },
    } as typeof baseEvent
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.summary.classification, "existing_contact_safe_for_reviewed_update");
    assert.equal(result.summary.matchedContactIdGhl, "ghl_phone_only");
    assert.equal(result.summary.emailSearchAttempted, false);
  }
});

test("email-only exact match returns safe reviewed update", async () => {
  const result = await runWithSearch(
    async (input) => {
      assert.equal(input.identityType, "email");
      return matched("ghl_email_only", "", "lead@example.com");
    },
    {
      ...baseEvent,
      normalizedPayloadJson: { contact: { email: "lead@example.com", state: "Texas" } },
    } as typeof baseEvent
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.summary.classification, "existing_contact_safe_for_reviewed_update");
    assert.equal(result.summary.matchedContactIdGhl, "ghl_email_only");
    assert.equal(result.summary.phoneSearchAttempted, false);
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
