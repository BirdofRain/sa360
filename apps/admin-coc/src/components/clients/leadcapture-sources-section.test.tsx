import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

import type { SourceFunnelAdminItem } from "@/lib/clients/source-funnels";
import {
  CLEAR_ASSOCIATION_CONFIRM_COPY,
  LEADCAPTURE_SOURCES_EMPTY_INPUT,
  LEADCAPTURE_SOURCES_UNRECOGNIZED,
} from "@/lib/clients/source-funnels.ts";

const originalLoad = (module as NodeModule & { _load: typeof module._load })._load;
(module as NodeModule & { _load: typeof module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "next/navigation") {
    return { useRouter: () => ({ refresh: () => undefined }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let LeadCaptureSourcesSection: typeof import("./leadcapture-sources-section.tsx").LeadCaptureSourcesSection;

test.before(async () => {
  ({ LeadCaptureSourcesSection } = await import("./leadcapture-sources-section.tsx"));
});

const originalConfirm = globalThis.window?.confirm;

function item(partial: Partial<SourceFunnelAdminItem> & { id: string }): SourceFunnelAdminItem {
  return {
    provider: "leadcapture_io",
    providerFunnelId: null,
    parentUrlKey: `my.leadcapture.io/p/${partial.pageSlug ?? partial.id}`,
    pageSlug: partial.pageSlug ?? "dn_omzoj",
    observedFunnelName: null,
    nicheKey: "vet_fex",
    associationStatus: "confirmed",
    suggestedClientAccountId: null,
    originClientAccountId: "madison_test_client",
    firstSeenAt: null,
    lastSeenAt: null,
    ...partial,
  };
}

function confirmed(id: string, slug: string, name: string | null, seen = false): SourceFunnelAdminItem {
  return item({
    id,
    pageSlug: slug,
    observedFunnelName: name,
    firstSeenAt: seen ? "2026-09-10T12:00:00.000Z" : null,
    lastSeenAt: seen ? "2026-09-10T12:00:00.000Z" : null,
  });
}

test.afterEach(() => {
  cleanup();
  if (originalConfirm) window.confirm = originalConfirm;
});

function renderSection(
  items: SourceFunnelAdminItem[],
  overrides: Partial<Parameters<typeof LeadCaptureSourcesSection>[0]> = {}
) {
  const associateCalls: string[] = [];
  const confirmCalls: string[] = [];
  const reassignCalls: string[] = [];
  const clearCalls: string[] = [];
  const listed: SourceFunnelAdminItem[][] = [items];
  render(
    <LeadCaptureSourcesSection
      clientAccountId="madison_test_client"
      clientDisplayName="Madison Test Client"
      initialItems={items}
      listAction={async () => ({ ok: true, items: listed[listed.length - 1]! })}
      associateAction={async (_id, pageUrlOrSlug) => {
        associateCalls.push(pageUrlOrSlug);
        return {
          ok: true,
          created: true,
          parentUrlKey: `my.leadcapture.io/p/${pageUrlOrSlug}`,
          pageSlug: pageUrlOrSlug,
          backfilledInventoryCount: 0,
          item: confirmed(`new_${pageUrlOrSlug}`, pageUrlOrSlug, null),
        };
      }}
      confirmAction={async (sourceFunnelId) => {
        confirmCalls.push(sourceFunnelId);
        return { ok: true, backfilledInventoryCount: 0, item: confirmed(sourceFunnelId, "sugg", "Suggested") };
      }}
      reassignAction={async (sourceFunnelId) => {
        reassignCalls.push(sourceFunnelId);
        return {
          ok: true,
          newlyStamped: 0,
          reassigned: 12,
          conflictsSkipped: 1,
          item: confirmed(sourceFunnelId, "dn_omzoj", null),
        };
      }}
      clearAction={async (sourceFunnelId) => {
        clearCalls.push(sourceFunnelId);
        return {
          ok: true,
          clearedInventoryCount: 12,
          item: { ...confirmed(sourceFunnelId, "cleared", null), associationStatus: "unassociated", originClientAccountId: null },
        };
      }}
      {...overrides}
    />
  );
  return { associateCalls, confirmCalls, reassignCalls, clearCalls, listed };
}

test("client detail LeadCapture Sources section renders heading, helper, and empty state", () => {
  renderSection([]);
  assert.ok(screen.getByRole("heading", { name: "LeadCapture Sources" }));
  assert.ok(screen.getByText(/A client can have more than one source page/));
  assert.ok(screen.getByLabelText("Page URL or slug"));
  assert.ok(screen.getByPlaceholderText("dn_omzoj"));
  assert.ok(
    screen.getByText(
      "Paste the full LeadCapture page URL. For standard my.leadcapture.io pages, you may also enter only the page slug."
    )
  );
  assert.ok(screen.getByText("Custom-domain pages must use the full URL."));
  assert.ok(screen.getByText(/dn_omzoj or https:\/\/my\.leadcapture\.io\/p\/dn_omzoj/));
  assert.ok(
    screen.getByText("https://healthcareworker.familylegacyprotection.com/learn-andru-duranso")
  );
  assert.ok(screen.getByRole("button", { name: "Associate source" }));
  assert.ok(screen.getByText("Associated sources (0)"));
  assert.ok(screen.getByText(/No LeadCapture sources associated yet/));
  assert.equal(screen.queryByText("This slug will be associated as:"), null);
  assert.equal(screen.queryByText("Source identity:"), null);
});

test("add form accepts a slug and a full URL", async () => {
  const { associateCalls } = renderSection([]);
  const input = screen.getByLabelText("Page URL or slug");
  fireEvent.change(input, { target: { value: "dn_omzoj" } });
  fireEvent.click(screen.getByRole("button", { name: "Associate source" }));
  await waitFor(() => {
    assert.deepEqual(associateCalls, ["dn_omzoj"]);
  });
  cleanup();
  const second = renderSection([]);
  fireEvent.change(screen.getByLabelText("Page URL or slug"), {
    target: { value: "https://my.leadcapture.io/p/dn_omzoj?v=1789074011990" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Associate source" }));
  await waitFor(() => {
    assert.deepEqual(second.associateCalls, [
      "https://my.leadcapture.io/p/dn_omzoj?v=1789074011990",
    ]);
  });
});

test("one, two, and three associated sources render independently and the first remains", () => {
  const one = [confirmed("sf1", "dn_omzoj", "Life Insurance For Veterans - Madison Pimentel V2", true)];
  renderSection(one);
  assert.ok(screen.getByText("Life Insurance For Veterans - Madison Pimentel V2"));
  assert.ok(screen.getByText("dn_omzoj"));
  assert.ok(screen.getByText("Associated sources (1)"));
  cleanup();

  const two = [
    ...one,
    confirmed("sf2", "6rci-usi", "Life Insurance For Veterans - Madison Pimentel V2 (Copy)", true),
  ];
  renderSection(two);
  assert.ok(screen.getByText("Life Insurance For Veterans - Madison Pimentel V2"));
  assert.ok(screen.getByText("Life Insurance For Veterans - Madison Pimentel V2 (Copy)"));
  assert.ok(screen.getByText("dn_omzoj"));
  assert.ok(screen.getByText("6rci-usi"));
  assert.ok(screen.getByText("Associated sources (2)"));
  cleanup();

  const three = [...two, confirmed("sf3", "third-source", null)];
  renderSection(three);
  assert.ok(screen.getByText("dn_omzoj"));
  assert.ok(screen.getByText("6rci-usi"));
  assert.ok(screen.getByText("third-source"));
  assert.ok(screen.getByText("LeadCapture source"));
  assert.ok(screen.getByText("Associated sources (3)"));
  assert.equal(screen.getAllByRole("button", { name: "Remove association" }).length, 3);
  assert.ok(screen.getByRole("button", { name: "Associate source" }));
});

test("pre-registered source renders Waiting for first lead; observed source renders funnel name", () => {
  renderSection([
    confirmed("sf1", "dn_omzoj", null, false),
    confirmed("sf2", "6rci-usi", "Life Insurance For Veterans - Madison Pimentel V2 (Copy)", true),
  ]);
  assert.ok(screen.getByText("Waiting for first lead"));
  assert.ok(screen.getByText("Life Insurance For Veterans - Madison Pimentel V2 (Copy)"));
  assert.ok(screen.getAllByText("Veteran").length >= 1);
  assert.ok(screen.getByText("Last seen Sep 10"));
});

test("suggested source renders Confirm action and does not treat suggestion as ownership", () => {
  renderSection([
    item({
      id: "sugg1",
      pageSlug: "dn_omzoj",
      observedFunnelName: "Life Insurance For Veterans - Madison Pimentel V2",
      associationStatus: "suggested",
      originClientAccountId: null,
      suggestedClientAccountId: "madison_test_client",
      firstSeenAt: "2026-09-10T00:00:00.000Z",
      lastSeenAt: "2026-09-10T00:00:00.000Z",
    }),
  ]);
  assert.ok(screen.getByText("Suggested sources"));
  assert.ok(screen.getByText("Suggested source"));
  assert.ok(screen.getByRole("button", { name: "Confirm association" }));
  assert.equal(screen.queryByRole("button", { name: "Remove association" }), null);
});

test("empty associate input shows a safe validation error", () => {
  renderSection([]);
  fireEvent.click(screen.getByRole("button", { name: "Associate source" }));
  assert.ok(screen.getByRole("alert").textContent?.includes(LEADCAPTURE_SOURCES_EMPTY_INPUT));
});

test("conflict shows existing owner and does not auto-reassign", async () => {
  const reassignCalls: string[] = [];
  renderSection([], {
    associateAction: async () => ({
      ok: false,
      error: "This source is already associated with another client.",
      code: "confirm_requires_explicit_reassign",
      sourceFunnelId: "sf_owned",
      parentUrlKey: "my.leadcapture.io/p/dn_omzoj",
      pageSlug: "dn_omzoj",
      currentOriginClientAccountId: "other_client",
      currentOriginClientDisplayName: "Madison Pimentel",
      requestedOriginClientAccountId: "madison_test_client",
      item: null,
    }),
    reassignAction: async (id) => {
      reassignCalls.push(id);
      return { ok: true, newlyStamped: 0, reassigned: 12, conflictsSkipped: 1, item: confirmed(id, "dn_omzoj", null) };
    },
  });
  fireEvent.change(screen.getByLabelText("Page URL or slug"), { target: { value: "dn_omzoj" } });
  fireEvent.click(screen.getByRole("button", { name: "Associate source" }));
  await waitFor(() => {
    assert.ok(screen.getByText("This LeadCapture source is already associated with:"));
  });
  assert.ok(screen.getByText("Madison Pimentel"));
  assert.ok(screen.getByRole("button", { name: "Reassign to Current Client" }));
  assert.deepEqual(reassignCalls, []);
});

test("reassign requires explicit confirmation", async () => {
  const reassignCalls: string[] = [];
  window.confirm = () => false;
  renderSection([], {
    associateAction: async () => ({
      ok: false,
      error: "This source is already associated with another client.",
      code: "confirm_requires_explicit_reassign",
      sourceFunnelId: "sf_owned",
      parentUrlKey: "my.leadcapture.io/p/dn_omzoj",
      pageSlug: "dn_omzoj",
      currentOriginClientAccountId: "other_client",
      currentOriginClientDisplayName: "Madison Pimentel",
      requestedOriginClientAccountId: "madison_test_client",
      item: null,
    }),
    reassignAction: async (id) => {
      reassignCalls.push(id);
      return { ok: true, newlyStamped: 0, reassigned: 1, conflictsSkipped: 0, item: confirmed(id, "dn_omzoj", null) };
    },
  });
  fireEvent.change(screen.getByLabelText("Page URL or slug"), { target: { value: "dn_omzoj" } });
  fireEvent.click(screen.getByRole("button", { name: "Associate source" }));
  await waitFor(() => {
    assert.ok(screen.getByRole("button", { name: "Reassign to Current Client" }));
  });
  fireEvent.click(screen.getByRole("button", { name: "Reassign to Current Client" }));
  assert.deepEqual(reassignCalls, []);
});

test("remove association requires confirmation and removing one row leaves the other", async () => {
  const remaining = [
    confirmed("sf1", "dn_omzoj", "Life Insurance For Veterans - Madison Pimentel V2", true),
  ];
  let listed = [
    ...remaining,
    confirmed("sf2", "6rci-usi", "Life Insurance For Veterans - Madison Pimentel V2 (Copy)", true),
  ];
  const clearCalls: string[] = [];
  window.confirm = (message) => {
    assert.match(String(message), /does not delete the source/);
    assert.equal(String(message), CLEAR_ASSOCIATION_CONFIRM_COPY);
    return true;
  };
  render(
    <LeadCaptureSourcesSection
      clientAccountId="madison_test_client"
      clientDisplayName="Madison Test Client"
      initialItems={listed}
      listAction={async () => ({ ok: true, items: listed })}
      associateAction={async () => ({ ok: false, error: "unused" })}
      confirmAction={async () => ({ ok: false, error: "unused" })}
      reassignAction={async () => ({ ok: false, error: "unused" })}
      clearAction={async (id) => {
        clearCalls.push(id);
        listed = remaining;
        return {
          ok: true,
          clearedInventoryCount: 12,
          item: {
            ...confirmed("sf2", "6rci-usi", null),
            associationStatus: "unassociated",
            originClientAccountId: null,
          },
        };
      }}
    />
  );
  fireEvent.click(screen.getAllByRole("button", { name: "Remove association" })[1]!);
  await waitFor(() => {
    assert.deepEqual(clearCalls, ["sf2"]);
  });
  await waitFor(() => {
    assert.ok(screen.getByText("dn_omzoj"));
    assert.equal(screen.queryByText("6rci-usi"), null);
    assert.ok(screen.getByText("Source association removed. 12 matching inventory records were cleared."));
  });
});

test("successful mutation refreshes the list and keeps the associate form", async () => {
  let listed: SourceFunnelAdminItem[] = [];
  render(
    <LeadCaptureSourcesSection
      clientAccountId="madison_test_client"
      clientDisplayName="Madison Test Client"
      initialItems={[]}
      listAction={async () => ({ ok: true, items: listed })}
      associateAction={async (_id, slug) => {
        const next = confirmed(`sf_${slug}`, slug, null);
        listed = [...listed, next];
        return {
          ok: true,
          created: true,
          parentUrlKey: next.parentUrlKey!,
          pageSlug: slug,
          backfilledInventoryCount: 0,
          item: next,
        };
      }}
      confirmAction={async () => ({ ok: false, error: "unused" })}
      reassignAction={async () => ({ ok: false, error: "unused" })}
      clearAction={async () => ({ ok: false, error: "unused" })}
    />
  );
  fireEvent.change(screen.getByLabelText("Page URL or slug"), { target: { value: "dn_omzoj" } });
  fireEvent.click(screen.getByRole("button", { name: "Associate source" }));
  await waitFor(() => {
    assert.ok(screen.getByText("dn_omzoj"));
    assert.ok(screen.getByText("Waiting for first lead"));
    assert.ok(screen.getByText(/Waiting for the first lead from this page/));
  });
  fireEvent.change(screen.getByLabelText("Page URL or slug"), { target: { value: "6rci-usi" } });
  fireEvent.click(screen.getByRole("button", { name: "Associate source" }));
  await waitFor(() => {
    assert.ok(screen.getByText("dn_omzoj"));
    assert.ok(screen.getByText("6rci-usi"));
    assert.ok(screen.getByText("Associated sources (2)"));
  });
});

test("safe API error rendering hides prisma text", async () => {
  renderSection([], {
    associateAction: async () => ({ ok: false, error: "PrismaClientKnownRequestError: SQLSTATE 23505" }),
  });
  fireEvent.change(screen.getByLabelText("Page URL or slug"), { target: { value: "dn_omzoj" } });
  fireEvent.click(screen.getByRole("button", { name: "Associate source" }));
  await waitFor(() => {
    assert.equal(screen.getByRole("alert").textContent, "Unable to complete source association.");
  });
  assert.equal(screen.queryByText(/Prisma/), null);
});

test("confirm suggested source calls confirm with the current page client id", async () => {
  const confirmCalls: Array<[string, string]> = [];
  renderSection(
    [
      item({
        id: "sugg1",
        pageSlug: "dn_omzoj",
        observedFunnelName: "Life Insurance For Veterans - Madison Pimentel V2",
        associationStatus: "suggested",
        originClientAccountId: null,
        suggestedClientAccountId: "madison_test_client",
      }),
    ],
    {
      confirmAction: async (sourceFunnelId, originClientAccountId) => {
        confirmCalls.push([sourceFunnelId, originClientAccountId]);
        return { ok: true, backfilledInventoryCount: 0, item: confirmed(sourceFunnelId, "dn_omzoj", "Life Insurance For Veterans - Madison Pimentel V2") };
      },
    }
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm association" }));
  await waitFor(() => {
    assert.deepEqual(confirmCalls, [["sugg1", "madison_test_client"]]);
  });
});

test("unrecognized API error uses the operator-safe copy when provided", async () => {
  renderSection([], {
    associateAction: async () => ({ ok: false, error: LEADCAPTURE_SOURCES_UNRECOGNIZED }),
  });
  fireEvent.change(screen.getByLabelText("Page URL or slug"), { target: { value: "nope!!!" } });
  fireEvent.click(screen.getByRole("button", { name: "Associate source" }));
  await waitFor(() => {
    assert.equal(screen.getByRole("alert").textContent, LEADCAPTURE_SOURCES_UNRECOGNIZED);
  });
});

test("client detail page hosts the LeadCapture Sources section", () => {
  const page = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../app/(dashboard)/clients/[clientAccountId]/page.tsx"),
    "utf8"
  );
  assert.match(page, /LeadCaptureSourcesSection/);
  assert.match(page, /fetchAdminClientSourceFunnels/);
});

test("helper text says custom-domain pages must use the full URL", () => {
  renderSection([]);
  assert.ok(screen.getByText("Custom-domain pages must use the full URL."));
  assert.ok(
    screen.getByText(
      "Paste the full LeadCapture page URL. For standard my.leadcapture.io pages, you may also enter only the page slug."
    )
  );
  assert.equal(screen.queryByText(/arbitrary slug-only input works for custom/i), null);
});

test("bare slug shows the standard-host association preview", () => {
  renderSection([]);
  fireEvent.change(screen.getByLabelText("Page URL or slug"), { target: { value: "dn_omzoj" } });
  assert.ok(screen.getByText("This slug will be associated as:"));
  assert.ok(screen.getByText("my.leadcapture.io/p/dn_omzoj"));
});

test("custom-domain full URL shows the normalized source identity", () => {
  renderSection([]);
  fireEvent.change(screen.getByLabelText("Page URL or slug"), {
    target: { value: "https://healthcareworker.familylegacyprotection.com/learn-andru-duranso" },
  });
  assert.ok(screen.getByText("Source identity:"));
  assert.ok(screen.getByText("healthcareworker.familylegacyprotection.com/learn-andru-duranso"));
});

test("query string is stripped from the full-URL identity preview", () => {
  renderSection([]);
  fireEvent.change(screen.getByLabelText("Page URL or slug"), {
    target: {
      value: "https://healthcareworker.familylegacyprotection.com/learn-andru-duranso?v=123",
    },
  });
  assert.ok(screen.getByText("healthcareworker.familylegacyprotection.com/learn-andru-duranso"));
  assert.equal(screen.queryByText(/v=123/), null);
});

test("standard slug association still submits the slug unchanged", async () => {
  const { associateCalls } = renderSection([]);
  fireEvent.change(screen.getByLabelText("Page URL or slug"), { target: { value: "dn_omzoj" } });
  fireEvent.click(screen.getByRole("button", { name: "Associate source" }));
  await waitFor(() => {
    assert.deepEqual(associateCalls, ["dn_omzoj"]);
  });
});

test("custom-domain full URL still submits the URL unchanged", async () => {
  const customUrl = "https://healthcareworker.familylegacyprotection.com/learn-andru-duranso";
  const submitted: string[] = [];
  renderSection([], {
    associateAction: async (_id, pageUrlOrSlug) => {
      submitted.push(pageUrlOrSlug);
      return {
        ok: true,
        created: true,
        parentUrlKey: "healthcareworker.familylegacyprotection.com/learn-andru-duranso",
        pageSlug: "learn-andru-duranso",
        backfilledInventoryCount: 0,
        item: item({
          id: "andru",
          pageSlug: "learn-andru-duranso",
          parentUrlKey: "healthcareworker.familylegacyprotection.com/learn-andru-duranso",
        }),
      };
    },
  });
  fireEvent.change(screen.getByLabelText("Page URL or slug"), { target: { value: customUrl } });
  fireEvent.click(screen.getByRole("button", { name: "Associate source" }));
  await waitFor(() => {
    assert.deepEqual(submitted, [customUrl]);
  });
});

test("observed custom-domain same slug warns and does not auto-substitute", async () => {
  const { associateCalls } = renderSection([
    item({
      id: "andru_observed",
      pageSlug: "learn-andru-duranso",
      parentUrlKey: "healthcareworker.familylegacyprotection.com/learn-andru-duranso",
      observedFunnelName: "Learn Andru Duranso",
      associationStatus: "suggested",
      originClientAccountId: null,
      suggestedClientAccountId: "madison_test_client",
    }),
  ]);
  fireEvent.change(screen.getByLabelText("Page URL or slug"), {
    target: { value: "learn-andru-duranso" },
  });
  assert.ok(screen.getByText("This slug will be associated as:"));
  assert.ok(screen.getByText("my.leadcapture.io/p/learn-andru-duranso"));
  assert.ok(screen.getByText("An observed source with this slug already exists on:"));
  assert.ok(screen.getByText("healthcareworker.familylegacyprotection.com"));
  assert.ok(screen.getByText("Use the full page URL to associate that source."));
  fireEvent.click(screen.getByRole("button", { name: "Associate source" }));
  await waitFor(() => {
    assert.deepEqual(associateCalls, ["learn-andru-duranso"]);
  });
});

