import assert from "node:assert/strict";
import test from "node:test";

import {
  COC_DETAIL_VIEW_MODE_STORAGE_KEY,
  defaultCocDetailViewMode,
  isCocDetailOverlayEnabled,
  parseCocDetailViewMode,
  readStoredCocDetailViewMode,
  writeStoredCocDetailViewMode,
} from "./coc-detail-overlay-config.ts";

test("isCocDetailOverlayEnabled is false when unset or falsey", (t) => {
  const prev = process.env.NEXT_PUBLIC_SA360_COC_DETAIL_OVERLAY_ENABLED;
  t.after(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SA360_COC_DETAIL_OVERLAY_ENABLED;
    else process.env.NEXT_PUBLIC_SA360_COC_DETAIL_OVERLAY_ENABLED = prev;
  });

  delete process.env.NEXT_PUBLIC_SA360_COC_DETAIL_OVERLAY_ENABLED;
  assert.equal(isCocDetailOverlayEnabled(), false);

  process.env.NEXT_PUBLIC_SA360_COC_DETAIL_OVERLAY_ENABLED = "false";
  assert.equal(isCocDetailOverlayEnabled(), false);

  process.env.NEXT_PUBLIC_SA360_COC_DETAIL_OVERLAY_ENABLED = "0";
  assert.equal(isCocDetailOverlayEnabled(), false);
});

test("isCocDetailOverlayEnabled is true for common truthy strings", (t) => {
  const prev = process.env.NEXT_PUBLIC_SA360_COC_DETAIL_OVERLAY_ENABLED;
  t.after(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SA360_COC_DETAIL_OVERLAY_ENABLED;
    else process.env.NEXT_PUBLIC_SA360_COC_DETAIL_OVERLAY_ENABLED = prev;
  });

  for (const v of ["true", "1", "yes", "on", "TRUE"]) {
    process.env.NEXT_PUBLIC_SA360_COC_DETAIL_OVERLAY_ENABLED = v;
    assert.equal(isCocDetailOverlayEnabled(), true, v);
  }
});

test("parseCocDetailViewMode defaults to overlay", () => {
  assert.equal(parseCocDetailViewMode(undefined), "overlay");
  assert.equal(parseCocDetailViewMode("docked"), "docked");
});

test("defaultCocDetailViewMode is overlay", () => {
  assert.equal(defaultCocDetailViewMode(), "overlay");
});

test("localStorage preference round-trip when window is available", () => {
  if (typeof globalThis.window === "undefined") {
    assert.equal(readStoredCocDetailViewMode(), null);
    return;
  }
  const prev = window.localStorage.getItem(COC_DETAIL_VIEW_MODE_STORAGE_KEY);
  try {
    writeStoredCocDetailViewMode("docked");
    assert.equal(readStoredCocDetailViewMode(), "docked");
    writeStoredCocDetailViewMode("overlay");
    assert.equal(readStoredCocDetailViewMode(), "overlay");
  } finally {
    if (prev === null) window.localStorage.removeItem(COC_DETAIL_VIEW_MODE_STORAGE_KEY);
    else window.localStorage.setItem(COC_DETAIL_VIEW_MODE_STORAGE_KEY, prev);
  }
});
