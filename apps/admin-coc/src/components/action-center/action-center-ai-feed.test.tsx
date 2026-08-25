import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";

import { ActionCenterAiFeed } from "./action-center-ai-feed.tsx";

test("renders an unknown activity kind without crashing", () => {
  render(
    <ActionCenterAiFeed
      items={[
        {
          id: "1",
          at: "2026-05-18T09:00:00.000Z",
          kind: "email",
          title: "Outbound email",
          displayName: "Alex",
        },
      ]}
    />
  );
  assert.ok(screen.getByText("Outbound email"));
  assert.ok(screen.getByText("Alex"));
  cleanup();
});

test("distinguishes unavailable activity from zero activity", () => {
  render(<ActionCenterAiFeed items={[]} availability="unavailable" />);
  assert.ok(screen.getByText("AI activity unavailable"));
  assert.equal(screen.queryByText("No AI activity"), null);
  cleanup();
});
