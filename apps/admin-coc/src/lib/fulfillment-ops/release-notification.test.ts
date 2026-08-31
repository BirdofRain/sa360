import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mapCustomerReleaseNotification,
  releaseNotificationRenderedText,
  RELEASE_NOTIFY_COPY,
} from "./release-notification.ts";

describe("mapCustomerReleaseNotification", () => {
  it("maps sent to Customer email sent with no manual action", () => {
    const view = mapCustomerReleaseNotification({ status: "sent" });
    assert.equal(view.kind, "sent");
    assert.equal(view.headline, "Customer email sent");
    assert.equal(view.action, null);
    assert.equal(view.explanation, null);
  });

  it("maps sent/already_sent as sent without exposing the reason", () => {
    const view = mapCustomerReleaseNotification({ status: "sent", reason: "already_sent" });
    assert.equal(view.kind, "sent");
    assert.equal(view.headline, RELEASE_NOTIFY_COPY.sent);
    assert.equal(view.action, null);
    const rendered = releaseNotificationRenderedText(view);
    assert.equal(rendered.includes("already_sent"), false);
    assert.equal(rendered, "Customer email sent");
  });

  it("maps failed without rendering an unsafe provider reason", () => {
    const unsafe =
      "Resend API 403 invalid_api_key id=re_3xAmPle portal password=hunter2 config=prod-smtp";
    const view = mapCustomerReleaseNotification({ status: "failed", reason: unsafe });
    assert.equal(view.kind, "failed");
    assert.equal(view.headline, "Customer email was not sent");
    assert.equal(view.action, "Notify customer manually");
    assert.equal(view.explanation, null);
    const rendered = releaseNotificationRenderedText(view);
    assert.equal(rendered.includes(unsafe), false);
    assert.equal(rendered.includes("Resend"), false);
    assert.equal(rendered.includes("invalid_api_key"), false);
    assert.equal(rendered.includes("re_3xAmPle"), false);
    assert.equal(rendered.includes("hunter2"), false);
    assert.equal(rendered.includes("prod-smtp"), false);
    assert.equal(JSON.stringify(view).includes(unsafe), false);
  });

  it("maps in_progress to pending and does not claim sent or failed", () => {
    const view = mapCustomerReleaseNotification({ status: "in_progress" });
    assert.equal(view.kind, "pending");
    assert.equal(view.headline, "Customer email pending");
    assert.equal(view.action, null);
    const rendered = releaseNotificationRenderedText(view);
    assert.equal(rendered.includes("Customer email sent"), false);
    assert.equal(rendered.includes("Customer email was not sent"), false);
  });

  it("defensively maps pending and sending as pending", () => {
    for (const status of ["pending", "sending", "PENDING", " in_progress "]) {
      const view = mapCustomerReleaseNotification({ status });
      assert.equal(view.kind, "pending", status);
      assert.equal(view.headline, RELEASE_NOTIFY_COPY.pending);
    }
  });

  it("maps skipped missing portal email with allowlisted copy only", () => {
    const view = mapCustomerReleaseNotification({
      status: "skipped",
      reason: "missing_portal_login_email",
    });
    assert.equal(view.kind, "skipped");
    assert.equal(view.headline, "No automated notification");
    assert.equal(view.action, "Notify customer manually");
    assert.equal(view.explanation, RELEASE_NOTIFY_COPY.skipReasons.missing_portal_login_email);
  });

  it("maps skipped invalid email and missing client account with allowlisted copy", () => {
    const invalid = mapCustomerReleaseNotification({
      status: "skipped",
      reason: "invalid_portal_login_email",
    });
    assert.equal(invalid.explanation, RELEASE_NOTIFY_COPY.skipReasons.invalid_portal_login_email);
    const missingAccount = mapCustomerReleaseNotification({
      status: "skipped",
      reason: "missing_client_account",
    });
    assert.equal(
      missingAccount.explanation,
      RELEASE_NOTIFY_COPY.skipReasons.missing_client_account
    );
  });

  it("omits non-allowlisted skipped reasons from rendered output", () => {
    const unsafe = "smtp relay 550 user unknown id=msg_secret";
    const view = mapCustomerReleaseNotification({ status: "skipped", reason: unsafe });
    assert.equal(view.kind, "skipped");
    assert.equal(view.headline, "No automated notification");
    assert.equal(view.explanation, null);
    const rendered = releaseNotificationRenderedText(view);
    assert.equal(rendered.includes(unsafe), false);
    assert.equal(rendered.includes("msg_secret"), false);
  });

  it("maps no_intent without claiming sent and uses the allowlisted explanation", () => {
    const view = mapCustomerReleaseNotification({
      status: "no_intent",
      reason: "legacy_no_notification_intent",
    });
    assert.equal(view.kind, "no_intent");
    assert.equal(view.headline, "No automated notification");
    assert.equal(view.action, "Notify customer manually");
    assert.equal(view.explanation, RELEASE_NOTIFY_COPY.noIntentExplanation);
    const rendered = releaseNotificationRenderedText(view);
    assert.equal(rendered.includes("Customer email sent"), false);
    assert.equal(rendered.includes("legacy_no_notification_intent"), false);
  });

  it("maps a missing field as unknown and does not claim email sent", () => {
    const view = mapCustomerReleaseNotification(undefined);
    assert.equal(view.kind, "unknown");
    assert.equal(view.headline, RELEASE_NOTIFY_COPY.unknown);
    assert.equal(view.action, null);
    assert.equal(releaseNotificationRenderedText(view).includes("Customer email sent"), false);
  });

  it("maps an unknown status as unknown and does not claim email sent", () => {
    const view = mapCustomerReleaseNotification({
      status: "queued_at_provider",
      reason: "resend_message_id=re_leak",
    });
    assert.equal(view.kind, "unknown");
    const rendered = releaseNotificationRenderedText(view);
    assert.equal(rendered.includes("Customer email sent"), false);
    assert.equal(rendered.includes("queued_at_provider"), false);
    assert.equal(rendered.includes("re_leak"), false);
  });
});
