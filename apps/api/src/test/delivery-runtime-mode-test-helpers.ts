import { __setEffectiveAdapterModeForTests } from "../lib/ghl-delivery-adapter-mode.js";
import {
  invalidateDeliveryRuntimeModeCache,
  setDeliveryRuntimeModeForTests,
} from "../services/delivery-runtime-mode.service.js";

export function resetDeliveryRuntimeTestState(): void {
  setDeliveryRuntimeModeForTests(null);
  invalidateDeliveryRuntimeModeCache();
  __setEffectiveAdapterModeForTests(null);
}

/** Enable DB-equivalent live_canary runtime for tests (requires env max live_canary). */
export function enableLiveCanaryRuntimeForTests(minutes = 60): void {
  const until = new Date(Date.now() + minutes * 60_000);
  setDeliveryRuntimeModeForTests({
    configuredRuntimeMode: "live_canary",
    liveCanaryEnabledUntil: until,
    reason: "test",
    enabledBy: "test",
  });
  __setEffectiveAdapterModeForTests("live_canary");
}
