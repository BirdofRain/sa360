import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

import {
  ClientGhlProfileMirrorCard,
  type GhlMirrorCardActions,
} from "./client-ghl-profile-mirror-card.tsx";
import type {
  ChannelMirrorSummary,
  ChannelReadinessReport,
  ChannelWriteModeInfo,
} from "@/lib/clients/channel-profile-types";

const writeMode: ChannelWriteModeInfo = {
  effectiveWriteMode: "simulate",
  maxWriteMode: "simulate",
  requestedWriteMode: "simulate",
  clamped: false,
  liveWritesEnabled: false,
};

const blockedGuardrails = {
  liveAllowed: false,
  checks: {
    featureEnabled: true,
    maxModeIsLive: false,
    effectiveModeIsLive: false,
    hasClientAllowlist: false,
    hasLocationAllowlist: false,
    clientAllowlisted: false,
    locationPresent: true,
    locationAllowlisted: false,
  },
  blockers: ["GHL_ADMIN_CONFIG_WRITE_MODE is not 'live' (environment maximum)."],
};

const mirror: ChannelMirrorSummary = {
  targetLocation: "loc_demo",
  liveAllowed: false,
  guardrails: blockedGuardrails,
};

const readiness: ChannelReadinessReport = {
  status: "PARTIAL",
  locationId: "loc_demo",
  snapshotFetchedAt: null,
  installedFields: [],
  missingFields: [],
  installedCustomValues: [],
  missingCustomValues: ["SA360_CLIENT_BLUE_ENABLED"],
  unverifiedCustomValues: [],
  customValuesVerified: true,
  canApplyProfileToGhl: true,
  warnings: [],
  notes: [],
};

function actions(overrides: Partial<GhlMirrorCardActions> = {}): GhlMirrorCardActions {
  return {
    previewAction: async () => ({
      ok: true,
      plan: {
        clientAccountId: "demo_client",
        subaccountIdGhl: null,
        targetLocation: "loc_demo",
        writeMode: "simulate",
        maxWriteMode: "simulate",
        discoveryAvailable: true,
        liveWritesPerformed: false,
        entries: [
          {
            key: "SA360_CLIENT_GREEN_ENABLED",
            intendedValue: "TRUE",
            currentValue: null,
            action: "CREATE",
            customValueId: null,
            skipReason: null,
          },
        ],
        notes: ["Preview only."],
      },
    }),
    applyAction: async () => ({
      ok: true,
      result: {
        clientAccountId: "demo_client",
        subaccountIdGhl: null,
        targetLocation: "loc_demo",
        writeMode: "simulate",
        maxWriteMode: "simulate",
        resultStatus: "simulated",
        liveWritesPerformed: false,
        guardrails: blockedGuardrails,
        valuesAttempted: 0,
        valuesWritten: 0,
        valuesSkipped: 1,
        results: [
          {
            key: "SA360_CLIENT_GREEN_ENABLED",
            intendedValue: "TRUE",
            currentValue: null,
            action: "CREATE",
            customValueId: null,
            skipReason: null,
            status: "simulated",
          },
        ],
        errorSummary: null,
        notes: [],
      },
    }),
    ...overrides,
  };
}

test.afterEach(() => cleanup());

test("renders GHL mirror card with mode, target, and source-of-truth copy", () => {
  render(
    <ClientGhlProfileMirrorCard
      clientAccountId="demo_client"
      subaccountIdGhl={null}
      mirror={mirror}
      writeMode={writeMode}
      readiness={readiness}
      lastAppliedAt={null}
      {...actions()}
    />
  );
  assert.ok(screen.getByText("GHL Profile Mirror"));
  assert.ok(screen.getByText(/SA360 Admin remains the source of truth/i));
  assert.ok(screen.getAllByText(/live writes blocked/i).length > 0);
});

test("missing custom values render as warnings, not crash", () => {
  render(
    <ClientGhlProfileMirrorCard
      clientAccountId="demo_client"
      subaccountIdGhl={null}
      mirror={mirror}
      writeMode={writeMode}
      readiness={readiness}
      lastAppliedAt={null}
      {...actions()}
    />
  );
  assert.ok(screen.getByText(/SA360_CLIENT_BLUE_ENABLED/));
});

test("shows live-blocked reason from guardrails", () => {
  render(
    <ClientGhlProfileMirrorCard
      clientAccountId="demo_client"
      subaccountIdGhl={null}
      mirror={mirror}
      writeMode={writeMode}
      readiness={readiness}
      lastAppliedAt={null}
      {...actions()}
    />
  );
  assert.ok(screen.getByText(/Live writes blocked because/i));
  assert.ok(screen.getByText(/environment maximum/i));
});

test("Preview displays the write plan", async () => {
  render(
    <ClientGhlProfileMirrorCard
      clientAccountId="demo_client"
      subaccountIdGhl={null}
      mirror={mirror}
      writeMode={writeMode}
      readiness={readiness}
      lastAppliedAt={null}
      {...actions()}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /Preview GHL Write Plan/i }));
  await waitFor(() => {
    assert.ok(screen.getByText(/SA360_CLIENT_GREEN_ENABLED/));
    assert.ok(screen.getByText(/Preview only — no writes performed/i));
  });
});

test("Apply shows blocked reason when apply returns blocked", async () => {
  const applyAction: GhlMirrorCardActions["applyAction"] = async () => ({
    ok: true,
    result: {
      clientAccountId: "demo_client",
      subaccountIdGhl: null,
      targetLocation: "loc_demo",
      writeMode: "live",
      maxWriteMode: "live",
      resultStatus: "blocked",
      liveWritesPerformed: false,
      guardrails: blockedGuardrails,
      valuesAttempted: 0,
      valuesWritten: 0,
      valuesSkipped: 1,
      results: [],
      errorSummary: "This client is not in the live-write client allowlist.",
      notes: [],
    },
  });
  render(
    <ClientGhlProfileMirrorCard
      clientAccountId="demo_client"
      subaccountIdGhl={null}
      mirror={mirror}
      writeMode={writeMode}
      readiness={readiness}
      lastAppliedAt={null}
      {...actions({ applyAction })}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /Apply Profile to GHL/i }));
  await waitFor(() => {
    assert.ok(screen.getByText(/not in the live-write client allowlist/i));
  });
});
