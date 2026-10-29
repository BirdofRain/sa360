/**
 * Durable service switch for association GHL writes.
 *
 * The admin live-canary window expires after at most 30 minutes and is not
 * the pilot switch. This flag stays on until an operator turns the service
 * off. It does not authorize a client. The saved destination still has to be
 * activated, or a selected test has to pass the location checks.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { isGhlLiveCanaryWriteAllowed } from "./ghl-delivery-adapter-mode.js";

const ongoingWrite = new AsyncLocalStorage<true>();

export function isOngoingGhlServiceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_GHL_ONGOING_DELIVERY_ENABLED?.trim().toLowerCase() === "true";
}

/** True only inside a recorded ongoing or selected-test execution while the service flag is on. */
export function ongoingGhlWriteAuthorized(): boolean {
  return ongoingWrite.getStore() === true && isOngoingGhlServiceEnabled();
}

export function ghlLiveWritePermitted(): boolean {
  return isGhlLiveCanaryWriteAllowed() || ongoingGhlWriteAuthorized();
}

export function runWithOngoingGhlWrite<T>(fn: () => Promise<T>): Promise<T> {
  if (!isOngoingGhlServiceEnabled()) return fn();
  return ongoingWrite.run(true, fn);
}
