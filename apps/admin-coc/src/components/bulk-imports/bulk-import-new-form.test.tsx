import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

import {
  BulkImportNewFormView,
  type UploadBulkImportCsv,
} from "./bulk-import-new-form.tsx";

const uploadCalls: Array<Record<string, unknown>> = [];
let shouldFailUpload = false;

const mockUploadAction: UploadBulkImportCsv = async (payload) => {
  uploadCalls.push(payload);
  if (shouldFailUpload) {
    throw new Error(
      "The SA360 API returned a non-JSON response (HTTP 500). Verify the C.O.C. API base URL."
    );
  }
  return { batch: { id: "uploaded-batch-id" } };
};

test.afterEach(() => {
  cleanup();
  uploadCalls.length = 0;
  shouldFailUpload = false;
});

test("selecting a file does not upload until Upload CSV is clicked", async () => {
  render(
    <BulkImportNewFormView
      uploadAction={mockUploadAction}
      navigateToImport={() => {}}
    />
  );

  const uploadButton = screen.getByRole("button", { name: "Upload CSV" });
  assert.equal(uploadButton.hasAttribute("disabled"), true);

  const fileInput = screen.getByLabelText(/csv file/i);
  const file = new File(["name,email\nJane,jane@example.com"], "leads.csv", {
    type: "text/csv",
  });
  fireEvent.change(fileInput, { target: { files: [file] } });

  assert.equal(uploadCalls.length, 0);
  assert.equal(uploadButton.hasAttribute("disabled"), false);
  assert.ok(screen.getByText("Selected: leads.csv"));

  fireEvent.click(uploadButton);
  await waitFor(() => assert.equal(uploadCalls.length, 1));

  assert.equal(uploadCalls[0]?.fileName, "leads.csv");
  assert.equal(uploadCalls[0]?.importLabel, undefined);
});

test("clicking Upload CSV includes trimmed importLabel in request body", async () => {
  render(
    <BulkImportNewFormView
      uploadAction={mockUploadAction}
      navigateToImport={() => {}}
    />
  );

  fireEvent.change(screen.getByLabelText(/import label/i), {
    target: { value: "  GOATLEAD TEST  " },
  });

  const file = new File(["a,b\n1,2"], "sa360_bulk_import_acceptance_test.csv", {
    type: "text/csv",
  });
  fireEvent.change(screen.getByLabelText(/csv file/i), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "Upload CSV" }));

  await waitFor(() => assert.equal(uploadCalls.length, 1));
  assert.equal(uploadCalls[0]?.importLabel, "GOATLEAD TEST");
  assert.equal(uploadCalls[0]?.fileName, "sa360_bulk_import_acceptance_test.csv");
});

test("failed upload preserves selected file and label", async () => {
  shouldFailUpload = true;
  render(
    <BulkImportNewFormView
      uploadAction={mockUploadAction}
      navigateToImport={() => {}}
    />
  );

  fireEvent.change(screen.getByLabelText(/import label/i), {
    target: { value: "KEEP ME" },
  });
  const file = new File(["x"], "keep.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText(/csv file/i), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "Upload CSV" }));

  await waitFor(() => screen.getByText(/non-JSON response/i));

  assert.ok(screen.getByText("Selected: keep.csv"));
  assert.equal((screen.getByLabelText(/import label/i) as HTMLInputElement).value, "KEEP ME");
  assert.match(
    screen.getByText(/non-JSON response/i).textContent ?? "",
    /Verify the C\.O\.C\. API base URL/
  );
  assert.equal(screen.getByRole("button", { name: "Upload CSV" }).hasAttribute("disabled"), false);
});
