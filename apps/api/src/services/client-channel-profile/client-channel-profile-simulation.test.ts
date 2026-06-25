import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CLIENT_CHANNEL_PROFILE } from "./client-channel-profile.constants.js";
import { simulateChannelProfileConfigWrites } from "./client-channel-profile-simulation.js";

test("simulation never performs live writes and annotates skip reasons", () => {
  const sim = simulateChannelProfileConfigWrites({
    profile: { ...DEFAULT_CLIENT_CHANNEL_PROFILE, blueEnabled: true },
    targetLocation: "loc_123",
  });
  assert.equal(sim.liveWritesPerformed, false);
  assert.ok(sim.configWrites.length > 0);
  for (const write of sim.configWrites) {
    assert.equal(write.targetLocation, "loc_123");
    assert.ok(write.skippedReason, "every simulated write has a skip reason");
  }
  const blue = sim.configWrites.find((w) => w.fieldName === "sa360_client_blue_enabled");
  assert.equal(blue?.intendedValue, "true");
});

test("simulation clamps write mode to environment max (default simulate)", () => {
  const prev = process.env.GHL_ADMIN_CONFIG_WRITE_MODE;
  delete process.env.GHL_ADMIN_CONFIG_WRITE_MODE;
  const sim = simulateChannelProfileConfigWrites({
    profile: { ...DEFAULT_CLIENT_CHANNEL_PROFILE, writeMode: "live" },
    targetLocation: null,
  });
  assert.equal(sim.maxWriteMode, "simulate");
  assert.equal(sim.writeMode, "simulate");
  assert.ok(sim.notes.some((n) => n.toLowerCase().includes("clamp")));
  if (prev !== undefined) process.env.GHL_ADMIN_CONFIG_WRITE_MODE = prev;
});
