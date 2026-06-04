import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { CocDetailViewShell } from "./CocDetailViewShell.tsx";

test.afterEach(() => {
  cleanup();
});

test("feature flag disabled renders legacy sheet dialog", (t) => {
  const prev = process.env.NEXT_PUBLIC_SA360_COC_DETAIL_OVERLAY_ENABLED;
  t.after(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SA360_COC_DETAIL_OVERLAY_ENABLED;
    else process.env.NEXT_PUBLIC_SA360_COC_DETAIL_OVERLAY_ENABLED = prev;
  });
  delete process.env.NEXT_PUBLIC_SA360_COC_DETAIL_OVERLAY_ENABLED;

  render(
    <CocDetailViewShell open onOpenChange={() => {}} title="Legacy title">
      <p>Legacy body</p>
    </CocDetailViewShell>
  );

  assert.ok(screen.getByText("Legacy title"));
  assert.ok(screen.getByText("Legacy body"));
  const sheet = document.querySelector('[data-slot="sheet-content"]');
  assert.ok(sheet, "expected sheet content when flag off");
});
