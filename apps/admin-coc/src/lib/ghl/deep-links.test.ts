import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGhlAppUrl,
  buildSafeTelHref,
  GHL_DEEP_LINK_PATHS,
  getGhlAppOrigin,
  hasAppointmentLinkSignal,
  resolveGhlPriorityLeadLinks,
} from "./deep-links.ts";

test("buildGhlAppUrl uses default origin and encodes ids", () => {
  const prev = process.env.NEXT_PUBLIC_GHL_APP_BASE_URL;
  delete process.env.NEXT_PUBLIC_GHL_APP_BASE_URL;
  const href = buildGhlAppUrl(GHL_DEEP_LINK_PATHS.contact, {
    locationId: "loc/1",
    contactId: "c 2",
  });
  assert.equal(getGhlAppOrigin(), "https://app.gohighlevel.com");
  assert.equal(
    href,
    "https://app.gohighlevel.com/v2/location/loc%2F1/contacts/detail/c%202"
  );
  if (prev !== undefined) process.env.NEXT_PUBLIC_GHL_APP_BASE_URL = prev;
});

test("resolveGhlPriorityLeadLinks disables contact actions without contactIdGhl", () => {
  const links = resolveGhlPriorityLeadLinks({
    locationId: "loc_1",
    contactIdGhl: "",
    phoneE164: "+15551234001",
  });
  assert.equal(links.openInGhl.disabled, true);
  assert.equal(links.openInGhl.label, "Missing GHL ID");
  assert.equal(links.openConversation.disabled, true);
});

test("resolveGhlPriorityLeadLinks enables tel when E.164 valid", () => {
  const links = resolveGhlPriorityLeadLinks({
    locationId: "loc_1",
    contactIdGhl: "ghl_abc",
    phoneE164: "+15551234001",
  });
  assert.equal(links.callNext.disabled, false);
  if (!links.callNext.disabled) {
    assert.equal(links.callNext.href, "tel:+15551234001");
  }
});

test("hasAppointmentLinkSignal respects appointmentStatus and reasonCode", () => {
  assert.equal(hasAppointmentLinkSignal({ appointmentStatus: "Confirmed" }), true);
  assert.equal(
    hasAppointmentLinkSignal({ reasonCode: "ai_appointment_ready" }),
    true
  );
  assert.equal(hasAppointmentLinkSignal({}), false);
});

test("buildSafeTelHref rejects invalid numbers", () => {
  assert.equal(buildSafeTelHref("555-1234"), null);
  assert.equal(buildSafeTelHref("+15551234001"), "tel:+15551234001");
});
