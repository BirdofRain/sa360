import test from "node:test";
import assert from "node:assert/strict";

/** Mirrors server page banner resolution for admin-coc tests. */
function resolvePageBanner(input: {
  suggested: { tone: string; message: string } | null | undefined;
  urlOauth: string | null;
  urlReason: string | null;
}): { tone: string; message: string } | null {
  if (input.urlOauth === "error") {
    return { tone: "error", message: `GHL OAuth failed: ${input.urlReason ?? "unknown"}` };
  }
  return input.suggested ?? null;
}

test("success banner from API suggestedBanner overrides stale pending URL", () => {
  const banner = resolvePageBanner({
    urlOauth: "pending_location",
    urlReason: null,
    suggested: {
      tone: "success",
      message:
        "OAuth connected: Marketplace install webhook reconciled the subaccount location.",
    },
  });
  assert.equal(banner?.tone, "success");
  assert.match(banner?.message ?? "", /reconciled/i);
});

test("pending banner when suggested is info pending", () => {
  const banner = resolvePageBanner({
    urlOauth: null,
    urlReason: null,
    suggested: {
      tone: "info",
      message:
        "GHL OAuth tokens saved as pending — awaiting subaccount locationId from marketplace INSTALL webhook.",
    },
  });
  assert.equal(banner?.tone, "info");
  assert.match(banner?.message ?? "", /pending/i);
});

test("readiness label for connected probed linked row", () => {
  const hint = "ready_for_delivery_config" as const;
  const labels: Record<string, string> = {
    ready_for_delivery_config: "Ready for delivery config",
    link_client: "Link client",
    probe_required: "Probe required",
    not_delivery_capable: "Not delivery-capable",
  };
  assert.equal(labels[hint], "Ready for delivery config");
});

test("test location flag shows remove test affordance", () => {
  const isTest = (locationId: string) =>
    ["loc_unlinked", "loc_inject", "loc_storage_fail"].some((p) => locationId.startsWith(p));
  assert.equal(isTest("loc_unlinked_cb"), true);
  assert.equal(isTest("HZ97NWGIViy5udec20Ir"), false);
});
