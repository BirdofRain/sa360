import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";

import { presentBulkImportList } from "@/lib/bulk-imports/present-bulk-import-list.ts";

import { BulkImportListPanel } from "./bulk-import-list-panel.tsx";

const sampleItem = {
  id: "imp_1",
  fileName: "leads.csv",
  status: "READY_FOR_REVIEW",
  totalRows: 10,
  validRows: 8,
  deliveredRows: 2,
  createdAt: "2026-05-18T12:00:00.000Z",
};

test("successful empty list shows the legitimate empty state", () => {
  render(
    <BulkImportListPanel
      list={presentBulkImportList({ ok: true, data: { items: [] } })}
      showRetry={false}
    />
  );
  assert.ok(screen.getByText("No import batches yet."));
  assert.equal(screen.queryByText("Bulk imports unavailable"), null);
  cleanup();
});

test("successful populated list preserves row values and has no error state", () => {
  render(
    <BulkImportListPanel
      list={presentBulkImportList({ ok: true, data: { items: [sampleItem] } })}
      renderActions={(item) => <span>Open {item.id}</span>}
      showRetry={false}
    />
  );
  assert.ok(screen.getByText("leads.csv"));
  assert.ok(screen.getByText("READY_FOR_REVIEW"));
  assert.ok(screen.getByText("8/10"));
  assert.ok(screen.getByText("2"));
  assert.ok(screen.getByText("Open imp_1"));
  assert.equal(screen.queryByText("No import batches yet."), null);
  assert.equal(screen.queryByText("Bulk imports unavailable"), null);
  cleanup();
});

test("API failure does not render empty-success copy", () => {
  render(
    <BulkImportListPanel
      list={presentBulkImportList({
        ok: false,
        status: 503,
        error: "api_error",
        message: "upstream unavailable",
      })}
      showRetry={false}
    />
  );
  assert.ok(screen.getByText("Bulk imports unavailable"));
  assert.ok(screen.getByText("upstream unavailable"));
  assert.equal(screen.queryByText("No import batches yet."), null);
  cleanup();
});

test("authorization failure is not an empty list", () => {
  render(
    <BulkImportListPanel
      list={presentBulkImportList({
        ok: false,
        status: 401,
        error: "unauthorized",
        message: "Admin key rejected",
      })}
      showRetry={false}
    />
  );
  assert.ok(screen.getByText("Unable to load bulk imports — authorization failed"));
  assert.equal(screen.queryByText("No import batches yet."), null);
  cleanup();
});

test("malformed non-JSON response is unavailable, not empty", () => {
  render(
    <BulkImportListPanel
      list={presentBulkImportList({
        ok: false,
        status: 200,
        error: "api_error",
        message: "Invalid JSON from admin API",
      })}
      showRetry={false}
    />
  );
  assert.ok(screen.getByText("Bulk imports unavailable"));
  assert.match(screen.getByText(/non-JSON response/i).textContent ?? "", /non-JSON response/i);
  assert.equal(screen.queryByText("No import batches yet."), null);
  cleanup();
});
