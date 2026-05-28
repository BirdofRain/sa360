import { GHL_LIVE_NOT_IMPLEMENTED } from "../../lib/ghl-delivery-adapter-mode.js";

/** Throws if code attempts a GHL write in Phase 4H. */
export function assertGhlWriteTransportNotUsed(operation: string): never {
  throw new Error(`${GHL_LIVE_NOT_IMPLEMENTED} (attempted: ${operation})`);
}

export function isGhlWriteTransportAllowed(): boolean {
  return false;
}
