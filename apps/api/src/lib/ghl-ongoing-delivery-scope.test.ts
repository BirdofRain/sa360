import assert from "node:assert/strict";
import test from "node:test";

import { __setEffectiveAdapterModeForTests } from "./ghl-delivery-adapter-mode.js";
import { ghlLiveJson } from "../services/ghl-delivery-adapter/ghl-live-transport.js";
import {
  ghlLiveWritePermitted,
  isOngoingGhlServiceEnabled,
  ongoingGhlWriteAuthorized,
  runWithOngoingGhlWrite,
} from "./ghl-ongoing-delivery-scope.js";

const FLAG = "SA360_GHL_ONGOING_DELIVERY_ENABLED";

function withFlag(value: string | undefined, run: () => Promise<void> | void): Promise<void> {
  const previous = process.env[FLAG];
  if (value === undefined) delete process.env[FLAG];
  else process.env[FLAG] = value;
  const restore = () => {
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
  };
  return Promise.resolve(run()).then(
    () => {
      restore();
    },
    (err: unknown) => {
      restore();
      throw err;
    }
  );
}

test("the ongoing service flag is exact true", () => {
  assert.equal(isOngoingGhlServiceEnabled({ [FLAG]: "true" } as NodeJS.ProcessEnv), true);
  assert.equal(isOngoingGhlServiceEnabled({ [FLAG]: "TRUE" } as NodeJS.ProcessEnv), true);
  assert.equal(isOngoingGhlServiceEnabled({} as NodeJS.ProcessEnv), false);
  assert.equal(isOngoingGhlServiceEnabled({ [FLAG]: "false" } as NodeJS.ProcessEnv), false);
  assert.equal(isOngoingGhlServiceEnabled({ [FLAG]: "" } as NodeJS.ProcessEnv), false);
});

test("an enabled service authorizes only the recorded write scope", async () => {
  await withFlag("true", async () => {
    __setEffectiveAdapterModeForTests("simulate");
    assert.equal(ongoingGhlWriteAuthorized(), false);
    assert.equal(ghlLiveWritePermitted(), false);
    const inside = await runWithOngoingGhlWrite(async () => ongoingGhlWriteAuthorized());
    assert.equal(inside, true);
    assert.equal(ongoingGhlWriteAuthorized(), false);
    __setEffectiveAdapterModeForTests(null);
  });
});

test("a closed service still allows the short live-canary window", async () => {
  await withFlag(undefined, async () => {
    __setEffectiveAdapterModeForTests("live_canary");
    assert.equal(isOngoingGhlServiceEnabled(), false);
    assert.equal(ghlLiveWritePermitted(), true);
    __setEffectiveAdapterModeForTests(null);
  });
});

test("a disabled service does not authorize the recorded write scope", async () => {
  await withFlag(undefined, async () => {
    __setEffectiveAdapterModeForTests("simulate");
    const inside = await runWithOngoingGhlWrite(async () => ghlLiveWritePermitted());
    assert.equal(inside, false);
    __setEffectiveAdapterModeForTests(null);
  });
});

test("live transport refuses a write when the service is off and the canary window is closed", async () => {
  await withFlag(undefined, async () => {
    __setEffectiveAdapterModeForTests("simulate");
    let called = false;
    await assert.rejects(
      () =>
        ghlLiveJson(
          {
            fetch: async () => {
              called = true;
              throw new Error("fetch_should_not_run");
            },
          },
          "POST",
          "/contacts/"
        ),
      /effective runtime mode live_canary/
    );
    assert.equal(called, false);
    __setEffectiveAdapterModeForTests(null);
  });
});
