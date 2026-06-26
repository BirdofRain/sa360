import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

import {
  ClientChannelProfilePanel,
  type ChannelProfilePanelActions,
} from "./client-channel-profile-panel.tsx";
import type {
  ChannelProfile,
  ChannelReadinessReport,
  ChannelWriteModeInfo,
} from "@/lib/clients/channel-profile-types";

const defaultProfile: ChannelProfile = {
  clientAccountId: "demo_client",
  subaccountIdGhl: null,
  exists: false,
  blueEnabled: false,
  greenEnabled: true,
  voiceEnabled: false,
  closebotEnabled: false,
  ghlAiEnabled: false,
  aiProvider: "NONE",
  defaultLeadChannel: "AUTO",
  fallbackChannel: "GREEN",
  requiresSameNumberContinuity: true,
  blueNumber: null,
  greenNumber: null,
  voiceNumber: null,
  blueHealthStatus: null,
  greenHealthStatus: null,
  sendblueMaxNoReplyAttempts: 4,
  sendblueWindowDays: 4,
  textStartHour: 9,
  textEndHour: 21,
  preferredContactWindow: "ANYTIME_ALLOWED",
  applyDefaultScope: "NEW_LEADS_ONLY",
  writeMode: "simulate",
  lastValidatedAt: null,
  lastAppliedAt: null,
  createdAt: null,
  updatedAt: null,
};

const writeMode: ChannelWriteModeInfo = {
  effectiveWriteMode: "simulate",
  maxWriteMode: "simulate",
  requestedWriteMode: "simulate",
  clamped: false,
  liveWritesEnabled: false,
};

const readinessPartial: ChannelReadinessReport = {
  status: "PARTIAL",
  locationId: "loc_1",
  snapshotFetchedAt: null,
  installedFields: ["sa360_client_blue_enabled"],
  missingFields: ["sa360_channel_mode", "sa360_voice_enabled"],
  installedCustomValues: [],
  missingCustomValues: ["SA360_CLIENT_BLUE_ENABLED"],
  unverifiedCustomValues: [],
  customValuesVerified: true,
  canApplyProfileToGhl: true,
  warnings: ["GHL location is not connected; using cached data only."],
  notes: ["GHL custom values existence verified."],
};

function actions(overrides: Partial<ChannelProfilePanelActions> = {}): ChannelProfilePanelActions {
  return {
    saveAction: async () => ({ ok: false, error: "not implemented" }),
    validateAction: async () => ({ ok: true, readiness: readinessPartial }),
    impactAction: async () => ({
      ok: true,
      preview: {
        available: false,
        message: "Impact preview unavailable until lead index/admin contact data is available.",
        applyScope: "NEW_LEADS_ONLY",
        dataSource: null,
        totalIndexedContacts: 0,
        buckets: {
          newLeadsAffected: { count: null },
          activeLockedLeadsAffected: { count: null },
          activeUnlockedLeadsAffected: { count: null },
          eligibleForRecalculation: { count: null },
          requiresReview: { count: null },
          skippedChannelLocked: { count: null },
          skippedDncDeadOrBadNumber: { count: null },
        },
        notes: [],
      },
    }),
    ...overrides,
  };
}

test.afterEach(() => cleanup());

test("settings panel renders with default profile", () => {
  render(
    <ClientChannelProfilePanel
      clientAccountId="demo_client"
      initialProfile={defaultProfile}
      initialWriteMode={writeMode}
      initialReadiness={readinessPartial}
      {...actions()}
    />
  );
  assert.ok(screen.getByRole("button", { name: "Save Profile" }));
  assert.ok(screen.getByText("Blue enabled"));
  assert.ok(screen.getByText("Green enabled"));
  assert.ok(screen.getByText(/Validate GHL Readiness/i));
});

test("missing fields and custom values render as warnings, not crashes", () => {
  render(
    <ClientChannelProfilePanel
      clientAccountId="demo_client"
      initialProfile={defaultProfile}
      initialWriteMode={writeMode}
      initialReadiness={readinessPartial}
      {...actions()}
    />
  );
  assert.ok(screen.getByText(/sa360_channel_mode/));
  assert.ok(screen.getByText(/SA360_CLIENT_BLUE_ENABLED/));
});

test("force migrate option is warning + simulation-only (write mode disabled)", () => {
  const { container } = render(
    <ClientChannelProfilePanel
      clientAccountId="demo_client"
      initialProfile={defaultProfile}
      initialWriteMode={writeMode}
      initialReadiness={readinessPartial}
      {...actions()}
    />
  );
  const radios = container.querySelectorAll('input[name="applyDefaultScope"]');
  // Order: NEW_LEADS_ONLY, ACTIVE_UNLOCKED_ONLY, FORCE_MIGRATE_SELECTED
  const forceRadio = radios[2] as HTMLInputElement;
  fireEvent.click(forceRadio);
  assert.ok(screen.getByText(/simulation-only — write mode is forced to simulate/i));
  const writeModeSelect = Array.from(container.querySelectorAll("select")).find((s) =>
    Array.from(s.options).some((o) => o.value === "live")
  ) as HTMLSelectElement;
  assert.equal(writeModeSelect.disabled, true);
});

test("saving a valid profile updates the form (success, no legacy simulation table)", async () => {
  const saveAction: ChannelProfilePanelActions["saveAction"] = async () => ({
    ok: true,
    data: {
      profile: { ...defaultProfile, blueEnabled: true, exists: true, updatedAt: new Date().toISOString() },
      writeMode,
      simulation: {
        writeMode: "simulate",
        maxWriteMode: "simulate",
        liveWritesPerformed: false,
        configWrites: [],
        notes: [],
      },
    },
  });
  render(
    <ClientChannelProfilePanel
      clientAccountId="demo_client"
      initialProfile={defaultProfile}
      initialWriteMode={writeMode}
      initialReadiness={readinessPartial}
      {...actions({ saveAction })}
    />
  );
  const blueToggle = screen.getByLabelText("Blue enabled") as HTMLInputElement;
  assert.equal(blueToggle.checked, false);
  fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));
  await waitFor(() => {
    assert.equal((screen.getByLabelText("Blue enabled") as HTMLInputElement).checked, true);
  });
  // The legacy "Simulation — what would be written" table is no longer rendered.
  assert.equal(screen.queryByText(/Simulation — what would be written/i), null);
});

test("invalid combination renders inline validation errors", async () => {
  const saveAction: ChannelProfilePanelActions["saveAction"] = async () => ({
    ok: false,
    error: "Channel profile validation failed.",
    details: [
      { field: "defaultLeadChannel", message: "Default lead channel is BLUE but Blue is not enabled." },
    ],
  });
  render(
    <ClientChannelProfilePanel
      clientAccountId="demo_client"
      initialProfile={defaultProfile}
      initialWriteMode={writeMode}
      initialReadiness={readinessPartial}
      {...actions({ saveAction })}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));
  await waitFor(() => {
    assert.ok(
      screen.getAllByText(/Default lead channel is BLUE but Blue is not enabled\./).length > 0
    );
  });
});

test("impact preview unavailable result renders without crashing", async () => {
  render(
    <ClientChannelProfilePanel
      clientAccountId="demo_client"
      initialProfile={defaultProfile}
      initialWriteMode={writeMode}
      initialReadiness={readinessPartial}
      {...actions()}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /Preview Existing Lead Impact/i }));
  await waitFor(() => {
    assert.ok(screen.getAllByText(/Impact preview unavailable until lead index/i).length > 0);
  });
});
