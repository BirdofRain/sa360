import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import type { ColumnMapAssignment, ColumnMapRecord, ColumnMapSavePublishResult } from "@/lib/clients/onboarding/types";

import { ColumnMapEditor } from "./column-map-editor";

test.afterEach(() => cleanup());

test("save and publish confirms visible suggestions and keeps an unresolved Age/DOB choice", async () => {
  const calls: Array<{ revision: number; assignments: ColumnMapAssignment[] }> = [];
  render(
    <ColumnMapEditor
      record={mapRecord()}
      campaignDispatchEnabled={false}
      actions={{
        saveAndPublishColumnMap: async (_mapId, input) => {
          calls.push({ revision: input.expectedRevision, assignments: input.assignments });
          const name = input.assignments.find((column) => column.sheetHeader === "Full Name");
          assert.equal(name?.explicit, false);
          assert.equal(name?.target?.sourceField, "full_name");
          const age = input.assignments.find((column) => column.sheetHeader === "Age/DOB");
          assert.equal(age?.decision, "ambiguous");
          return {
            ok: false,
            error: "mapping_unresolved",
            status: 422,
            detail: "Age/DOB is still unresolved. Choose Age, DOB, or blank. Unresolved: Age/DOB, Score.",
            published: false,
            deliveryEnabled: false,
            map: {
              ...mapRecord(),
              revision: 2,
              assignments: input.assignments.map((column) =>
                column.decision === "mapped" ? { ...column, explicit: true } : column
              ),
            },
          };
        },
      }}
      onChange={() => undefined}
    />
  );

  assert.equal(screen.getAllByText(/Suggestion only/).length >= 1, true);
  assert.ok(screen.getByText(/Draft revision 1/));
  fireEvent.click(screen.getByRole("button", { name: "Save & publish mapping" }));
  assert.ok(await screen.findByRole("alert"));
  assert.match(screen.getByRole("alert").textContent ?? "", /Age\/DOB is still unresolved/);
  assert.match(screen.getByTestId("column-map-state").textContent ?? "", /Draft revision 2/);
  assert.equal(screen.queryByText(/Campaign delivery was not enabled/), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.revision, 1);
  assert.equal(screen.queryByText(/Suggestion only/), null);
});

test("choosing DOB publishes that choice and does not enable delivery", async () => {
  let saved: ColumnMapAssignment[] = [];
  render(
    <ColumnMapEditor
      record={mapRecord()}
      campaignDispatchEnabled={false}
      actions={{
        saveAndPublishColumnMap: async (_mapId, input) => {
          saved = input.assignments;
          return published(input.assignments, input.expectedRevision + 2);
        },
      }}
      onChange={() => undefined}
    />
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Map Age/DOB" }), { target: { value: "date_of_birth" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Map Score" }), { target: { value: "unmapped" } });
  fireEvent.click(screen.getByRole("button", { name: "Save & publish mapping" }));
  assert.match((await screen.findByTestId("column-map-state")).textContent ?? "", /Published delivery configuration/);
  assert.match(screen.getByTestId("column-map-state").textContent ?? "", /was not enabled/);
  assert.equal(saved.find((column) => column.sheetHeader === "Age/DOB")?.target?.sourceField, "date_of_birth");
  assert.equal(saved.find((column) => column.sheetHeader === "Age/DOB")?.explicit, true);
  assert.equal(saved.find((column) => column.sheetHeader === "Score")?.decision, "unmapped");
  assert.equal(saved.find((column) => column.sheetHeader === "Score")?.explicit, true);
});

test("save and publish sends unsaved dropdown edits with the current revision", async () => {
  const captured: { revision: number | null; assignments: ColumnMapAssignment[] } = { revision: null, assignments: [] };
  render(
    <ColumnMapEditor
      record={mapRecord()}
      campaignDispatchEnabled={false}
      actions={{
        saveAndPublishColumnMap: async (_mapId, input) => {
          captured.revision = input.expectedRevision;
          captured.assignments = input.assignments;
          return {
            ok: false,
            error: "mapping_unresolved",
            status: 422,
            detail: "Age/DOB is still unresolved. Choose Age, DOB, or blank.",
            published: false,
            deliveryEnabled: false,
          } satisfies ColumnMapSavePublishResult;
        },
      }}
      onChange={() => undefined}
    />
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Map Phone Number" }), { target: { value: "unmapped" } });
  fireEvent.click(screen.getByRole("button", { name: "Save & publish mapping" }));
  assert.match((await screen.findByRole("alert")).textContent ?? "", /Age\/DOB is still unresolved/);
  assert.equal(captured.revision, 1);
  assert.equal(captured.assignments.find((column) => column.sheetHeader === "Phone Number")?.decision, "unmapped");
  assert.equal(captured.assignments.find((column) => column.sheetHeader === "Phone Number")?.explicit, true);
  assert.match(screen.getByTestId("column-map-state").textContent ?? "", /Draft revision 1/);
});

test("blank and formula columns have explicit controls and no fake lead field", async () => {
  let saved: ColumnMapAssignment[] = [];
  render(
    <ColumnMapEditor
      record={mapRecord()}
      campaignDispatchEnabled={false}
      actions={{
        saveAndPublishColumnMap: async (_mapId, input) => {
          saved = input.assignments;
          return published(input.assignments, 3);
        },
      }}
      onChange={() => undefined}
    />
  );
  const blank = screen.getByRole("combobox", { name: "Blank header" });
  assert.equal((blank as HTMLSelectElement).value, "blank");
  assert.equal(withinOptions(blank).includes("Client Name"), false);
  assert.equal(withinOptions(blank).includes("Leave blank"), true);
  const formula = screen.getByRole("combobox", { name: "Skip formula Running Total" });
  assert.equal((formula as HTMLSelectElement).value, "skip_formula");
  assert.equal(withinOptions(formula).includes("Notes"), false);
  fireEvent.change(screen.getByRole("combobox", { name: "Map Age/DOB" }), { target: { value: "date_of_birth" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Map Score" }), { target: { value: "unmapped" } });
  fireEvent.click(screen.getByRole("button", { name: "Save & publish mapping" }));
  await screen.findByText(/Published delivery configuration/);
  assert.equal(saved.find((column) => column.sheetHeader === "")?.target, null);
  assert.equal(saved.find((column) => column.sheetHeader === "")?.code, "blank_header");
  assert.equal(saved.find((column) => column.sheetHeader === "Running Total")?.target, null);
  assert.equal(saved.find((column) => column.sheetHeader === "Running Total")?.code, "formula_column_omitted");
});

test("a revision conflict stays a draft and does not look published", async () => {
  render(
    <ColumnMapEditor
      record={mapRecord()}
      campaignDispatchEnabled={false}
      actions={{
        saveAndPublishColumnMap: async () => ({
          ok: false,
          error: "revision_conflict",
          status: 409,
          detail: "The destination profile revision does not match this screen. Nothing was overwritten.",
          published: false,
          deliveryEnabled: false,
        }),
      }}
      onChange={() => undefined}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Save & publish mapping" }));
  assert.match((await screen.findByRole("alert")).textContent ?? "", /Nothing was overwritten/);
  const state = screen.getByTestId("column-map-state").textContent ?? "";
  assert.match(state, /Draft revision 1/);
  assert.doesNotMatch(state, /separate control/);
  assert.equal(screen.getByRole("button", { name: "Save & publish mapping" }).hasAttribute("disabled"), false);
});

test("a stale save response is ignored after the operator edits again", async () => {
  const gate: { finish: ((result: ColumnMapSavePublishResult) => void) | null } = { finish: null };
  render(
    <ColumnMapEditor
      record={mapRecord()}
      campaignDispatchEnabled={false}
      actions={{
        saveAndPublishColumnMap: () =>
          new Promise<ColumnMapSavePublishResult>((resolve) => {
            gate.finish = resolve;
          }),
      }}
      onChange={() => undefined}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Save & publish mapping" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Map Age/DOB" }), { target: { value: "consumer_age" } });
  gate.finish?.(published(mapRecord().assignments, 4));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const state = screen.getByTestId("column-map-state").textContent ?? "";
  assert.match(state, /Draft revision 1/);
  assert.doesNotMatch(state, /separate control/);
  assert.equal((screen.getByRole("combobox", { name: "Map Age/DOB" }) as HTMLSelectElement).value, "consumer_age");
  assert.equal(screen.getByRole("button", { name: "Save & publish mapping" }).hasAttribute("disabled"), false);
});

test("a stale preview is dropped when the map changes and a later preview stays", async () => {
  const record = mapRecord();
  const gate: { finish: ((value: { token: string }) => void) | null } = { finish: null };
  render(
    <ColumnMapEditor
      record={record}
      campaignDispatchEnabled={false}
      boundSchemaVersion="company_sheets_campaign_custom_v1"
      actions={{
        previewColumnMap: (_mapId, input) =>
          new Promise((resolve) => {
            gate.finish = () =>
              resolve({
                ok: true,
                data: {
                  configuration: "draft",
                  deliveryEnabled: false,
                  sendsRow: false,
                  available: true,
                  emptyReason: null,
                  sourceLeadEventId: "evt_old",
                  receivedAt: "2026-11-02T16:00:00.000Z",
                  mapId: record.id,
                  revision: input.expectedRevision,
                  spreadsheetId: record.spreadsheetId,
                  worksheetId: record.worksheetId,
                  headerFingerprint: record.headerFingerprint,
                  schemaVersion: record.baseSchemaVersion,
                  boundSchemaVersion: "company_sheets_campaign_custom_v1",
                  previewToken: input.previewToken,
                  warnings: [],
                  sheet: null,
                  cells: [
                    {
                      columnIndex: 0,
                      sheetHeader: "Full Name",
                      canonicalField: "full_name",
                      receivedAnswer: "STALE PERSON",
                      outputValue: "STALE PERSON",
                      reason: null,
                    },
                  ],
                },
              });
          }),
      }}
      onChange={() => undefined}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview received submission" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Map Age/DOB" }), { target: { value: "date_of_birth" } });
  gate.finish?.({ token: "old" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.body.textContent?.includes("STALE PERSON") ?? false, false);
  assert.equal(screen.queryByTestId("column-map-received-preview"), null);
});

test("a DOB column shows the sheet cell and lead-detail age status, and a source change clears it", async () => {
  const record = mapRecord();
  const pending: Array<
    (value: {
      eventId: string;
      output: string;
      provenance: "derived_from_date_of_birth" | "supplied" | "missing";
      conflict: boolean;
    }) => void
  > = [];
  const view = render(
    <ColumnMapEditor
      record={record}
      campaignDispatchEnabled={false}
      boundSchemaVersion="company_sheets_campaign_custom_v1"
      sourceEventId="evt_old"
      actions={{
        previewColumnMap: (_mapId, input) =>
          new Promise((resolve) => {
            pending.push((value) =>
              resolve({
                ok: true,
                data: previewData(record, input, value.eventId, value.output, value.provenance, value.conflict),
              })
            );
          }),
      }}
      onChange={() => undefined}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview received submission" }));
  pending[0]?.({ eventId: "evt_old", output: "04/12/1979", provenance: "derived_from_date_of_birth", conflict: false });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const cells = screen.getAllByRole("cell").map((cell) => cell.textContent);
  assert.equal(cells.includes("04/12/1979"), true);
  assert.equal(cells.includes("47"), false);
  const details = screen.getByTestId("column-map-dob-age").textContent ?? "";
  assert.match(details, /Age derived from DOB/);
  assert.match(details, /Derived age 47/);
  assert.match(details, /1979-04-12/);

  view.rerender(
    <ColumnMapEditor
      record={record}
      campaignDispatchEnabled={false}
      boundSchemaVersion="company_sheets_campaign_custom_v1"
      sourceEventId="evt_new"
      actions={{
        previewColumnMap: (_mapId, input) =>
          new Promise((resolve) => {
            pending.push((value) =>
              resolve({
                ok: true,
                data: previewData(record, input, value.eventId, value.output, value.provenance, value.conflict),
              })
            );
          }),
      }}
      onChange={() => undefined}
    />
  );
  assert.equal(screen.queryByTestId("column-map-received-preview"), null);

  fireEvent.click(screen.getByRole("button", { name: "Preview received submission" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Map Age/DOB" }), { target: { value: "date_of_birth" } });
  pending[1]?.({ eventId: "evt_old", output: "04/12/1979", provenance: "derived_from_date_of_birth", conflict: false });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(screen.queryByTestId("column-map-received-preview"), null);

  fireEvent.click(screen.getByRole("button", { name: "Preview received submission" }));
  pending[2]?.({ eventId: "evt_new", output: "64", provenance: "supplied", conflict: false });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const supplied = screen.getByTestId("column-map-dob-age").textContent ?? "";
  assert.match(supplied, /Supplied age/);
  assert.doesNotMatch(supplied, /differs/);
  assert.equal(screen.getAllByRole("cell").some((cell) => cell.textContent === "64"), true);

  fireEvent.click(screen.getByRole("button", { name: "Preview received submission" }));
  pending[3]?.({ eventId: "evt_new", output: "55", provenance: "supplied", conflict: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(screen.getByTestId("column-map-dob-age").textContent ?? "", /Supplied age differs from DOB-derived age/);

  fireEvent.click(screen.getByRole("button", { name: "Preview received submission" }));
  pending[4]?.({ eventId: "evt_new", output: "", provenance: "missing", conflict: false });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(screen.getByTestId("column-map-dob-age").textContent ?? "", /Missing DOB \/ reference information/);
});

function previewData(
  record: ColumnMapRecord,
  input: { expectedRevision: number; previewToken: string },
  eventId: string,
  output: string,
  provenance: "derived_from_date_of_birth" | "supplied" | "missing",
  conflict: boolean
) {
  return {
    configuration: "draft" as const,
    deliveryEnabled: false as const,
    sendsRow: false as const,
    available: true,
    emptyReason: null,
    sourceLeadEventId: eventId,
    receivedAt: "2026-11-02T16:00:00.000Z",
    mapId: record.id,
    revision: input.expectedRevision,
    spreadsheetId: record.spreadsheetId,
    worksheetId: record.worksheetId,
    headerFingerprint: record.headerFingerprint,
    schemaVersion: record.baseSchemaVersion,
    boundSchemaVersion: "company_sheets_campaign_custom_v1",
    previewToken: input.previewToken,
    warnings: [],
    cells: [
      {
        columnIndex: 0,
        sheetHeader: "Age/DOB",
        canonicalField: "date_of_birth",
        receivedAnswer: "1979-04-12",
        outputValue: output,
        reason: null,
      },
    ],
    sheet: {
      header: ["Age/DOB"],
      values: [output],
      dobAge: {
        age: conflict ? "55" : "47",
        dateOfBirth: "1979-04-12",
        dateOfBirthSheet: "04/12/1979",
        ageProvenance: provenance,
        dateOfBirthProvenance: "supplied" as const,
        derivedAge: "47",
        referenceDate: "2026-10-29",
        referenceRule: "submitted_at_utc_date_else_received_at_utc_date" as const,
        conflict,
      },
    },
  };
}

function withinOptions(select: HTMLElement): string[] {
  return [...select.querySelectorAll("option")].map((option) => option.textContent ?? "");
}

function published(assignments: ColumnMapAssignment[], revision: number): ColumnMapSavePublishResult {
  return {
    ok: true,
    published: true,
    deliveryEnabled: false,
    data: { ...mapRecord(), status: "published", revision, assignments },
  };
}

function mapRecord(): ColumnMapRecord {
  return {
    id: "map_1",
    revision: 1,
    mapVersion: 1,
    status: "draft",
    sourceScope: "shared",
    baseSchemaVersion: "legacy_custom",
    spreadsheetId: "sheet_existing_tab",
    worksheetId: 15,
    worksheetTitle: "VET Web Form",
    headerFingerprint: "abc123",
    headerSnapshot: ["Full Name", "Phone Number", "Age/DOB", "Score", "Running Total", ""],
    assignments: [
      mapped("Full Name", 0, "Client Name", "full_name"),
      mapped("Phone Number", 1, "Phone", "phone"),
      {
        sheetHeader: "Age/DOB",
        columnIndex: 2,
        formula: false,
        target: null,
        transform: "blank",
        decision: "ambiguous",
        explicit: false,
        code: "ambiguous_age_or_dob",
      },
      {
        sheetHeader: "Score",
        columnIndex: 3,
        formula: false,
        target: null,
        transform: "blank",
        decision: "unmapped",
        explicit: false,
        code: null,
      },
      {
        sheetHeader: "Running Total",
        columnIndex: 4,
        formula: true,
        target: null,
        transform: "blank",
        decision: "unmapped",
        explicit: false,
        code: "formula_column_omitted",
      },
      {
        sheetHeader: "",
        columnIndex: 5,
        formula: false,
        target: null,
        transform: "blank",
        decision: "unmapped",
        explicit: false,
        code: "blank_header",
      },
    ],
    issues: [
      { columnIndex: 0, sheetHeader: "Full Name", code: "mapping_unresolved", message: "Confirm this suggestion or mark the column unmapped." },
      { columnIndex: 2, sheetHeader: "Age/DOB", code: "ambiguous_age_or_dob", message: "Age/DOB is ambiguous. Choose Age, DOB, or leave it blank." },
      { columnIndex: 3, sheetHeader: "Score", code: "mapping_unresolved", message: "Confirm this suggestion or mark the column unmapped." },
    ],
    preview: [],
    targets: [
      { header: "Client Name", sourceField: "full_name" },
      { header: "Phone", sourceField: "phone" },
      { header: "Age", sourceField: "consumer_age" },
      { header: "DOB", sourceField: "date_of_birth" },
      { header: "Notes", sourceField: "notes" },
    ],
    append: {
      behavior: "new_row_only",
      headerRow: "not_rewritten",
      existingRows: "not_rewritten",
      formulaColumns: "omitted_when_header_or_row2_starts_with_equals",
    },
  };
}

function mapped(sheetHeader: string, columnIndex: number, header: string, sourceField: string): ColumnMapAssignment {
  return {
    sheetHeader,
    columnIndex,
    formula: false,
    target: { kind: "v3_column", header, sourceField },
    transform: sourceField === "date_of_birth" ? "date_america_new_york" : "passthrough",
    decision: "mapped",
    explicit: false,
    code: null,
  };
}
