import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { useState } from "react";

import type { GhlDiscoveredCustomField } from "@/lib/ghl-config/types";

import { GhlFieldMappingSelect } from "./ghl-field-mapping-select";

const AGE_ID = "AbC_field_age";
const REASON_ID = "ghl_field_primary_reason";
const BENEFICIARY_ID = "ghl_field_beneficiary";

const FIELDS: GhlDiscoveredCustomField[] = [
  { id: AGE_ID, name: "Consumer Age", key: "contact.age", fieldKey: "contact.age", dataType: "TEXT" },
  { id: REASON_ID, name: "Primary Reason", key: "contact.primary_reason", fieldKey: "contact.primary_reason", dataType: "TEXT" },
  { id: BENEFICIARY_ID, name: "Beneficiary", key: "contact.beneficiary", fieldKey: "contact.beneficiary", dataType: "TEXT" },
  ...Array.from({ length: 12 }, (_, index) => ({
    id: `ghl_field_extra_${index}`,
    name: `Extra Field ${index}`,
    key: `contact.extra_${index}`,
    fieldKey: `contact.extra_${index}`,
    dataType: "TEXT",
  })),
];

test.before(() => {
  if (!("ResizeObserver" in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
});

test.afterEach(() => cleanup());

function fieldTrigger(canonical: string) {
  return screen.getByRole("combobox", { name: `GHL field for ${canonical}` });
}

function openField(canonical: string) {
  fireEvent.click(fieldTrigger(canonical));
  return screen.getByRole("combobox", { name: `Search GHL fields for ${canonical}` });
}

function hiddenValue(canonical: string): string {
  const hidden = fieldTrigger(canonical).parentElement?.querySelector('input[aria-hidden="true"]');
  assert.ok(hidden instanceof HTMLInputElement);
  return hidden.value;
}

function typeIn(input: HTMLElement, value: string) {
  fireEvent.input(input, { target: { value }, inputType: "insertText" });
}

test("empty search lists every discovered field and Unmapped in a scrollable list", () => {
  render(
    <GhlFieldMappingSelect canonical="age" fields={FIELDS} value="" onChange={() => {}} />
  );
  const input = openField("age");
  assert.equal(input.value, "");
  const options = screen.getAllByRole("option");
  assert.equal(options.length, FIELDS.length + 1);
  assert.equal(options[0]?.textContent, "Unmapped");
  assert.match(options[1]?.textContent ?? "", /Consumer Age/);
  assert.match(options[1]?.textContent ?? "", new RegExp(AGE_ID));
  const list = screen.getByTestId("ghl-field-options-age");
  assert.match(list.className, /overflow-y-auto/);
  assert.match(list.className, /max-h-60/);
  assert.equal(screen.queryByText("No matching GHL fields."), null);
});

test("typing filters by field name or field id without changing the stored id", () => {
  const calls: string[] = [];
  render(
    <GhlFieldMappingSelect
      canonical="primary_reason"
      fields={FIELDS}
      value={AGE_ID}
      onChange={(fieldId) => calls.push(fieldId)}
    />
  );
  assert.match(fieldTrigger("primary_reason").textContent ?? "", /Consumer Age/);
  assert.match(fieldTrigger("primary_reason").textContent ?? "", new RegExp(AGE_ID));
  assert.equal(hiddenValue("primary_reason"), AGE_ID);

  const byName = openField("primary_reason");
  fireEvent.change(byName, { target: { value: "bEnEf" } });
  let options = screen.getAllByRole("option");
  assert.equal(options.length, 1);
  assert.match(options[0]?.textContent ?? "", /Beneficiary/);
  assert.match(options[0]?.textContent ?? "", new RegExp(BENEFICIARY_ID));
  assert.equal(calls.length, 0);
  assert.equal(hiddenValue("primary_reason"), AGE_ID);

  fireEvent.change(byName, { target: { value: "PRIMARY_REASON" } });
  options = screen.getAllByRole("option");
  assert.equal(options.length, 1);
  assert.match(options[0]?.textContent ?? "", new RegExp(REASON_ID));
  assert.equal(calls.length, 0);
  assert.equal(hiddenValue("primary_reason"), AGE_ID);
});

test("Enter selects the highlighted field id and Escape closes without saving search text", () => {
  function Harness() {
    const [fieldId, setFieldId] = useState(REASON_ID);
    return (
      <GhlFieldMappingSelect canonical="beneficiary" fields={FIELDS} value={fieldId} onChange={setFieldId} />
    );
  }
  render(<Harness />);

  let input = openField("beneficiary");
  typeIn(input, "not-a-real-field");
  assert.ok(screen.getByText("No matching GHL fields."));
  assert.equal(screen.queryByRole("option"), null);
  fireEvent.keyDown(input, { key: "Enter" });
  assert.equal(hiddenValue("beneficiary"), REASON_ID);
  assert.match(fieldTrigger("beneficiary").textContent ?? "", new RegExp(REASON_ID));

  input = openField("beneficiary");
  typeIn(input, "benef");
  fireEvent.keyDown(input, { key: "Enter" });
  assert.equal(hiddenValue("beneficiary"), BENEFICIARY_ID);
  assert.match(fieldTrigger("beneficiary").textContent ?? "", /Beneficiary/);
  assert.match(fieldTrigger("beneficiary").textContent ?? "", new RegExp(BENEFICIARY_ID));
  assert.equal(screen.queryByRole("combobox", { name: "Search GHL fields for beneficiary" }), null);

  input = openField("beneficiary");
  typeIn(input, "age");
  fireEvent.keyDown(input, { key: "Escape" });
  assert.equal(screen.queryByRole("combobox", { name: "Search GHL fields for beneficiary" }), null);
  assert.match(fieldTrigger("beneficiary").textContent ?? "", /Beneficiary/);
  assert.equal(hiddenValue("beneficiary"), BENEFICIARY_ID);
});

test("arrow keys move the highlight and Unmapped clears the stored field id", () => {
  function Harness() {
    const [fieldId, setFieldId] = useState(REASON_ID);
    return (
      <GhlFieldMappingSelect canonical="age" fields={FIELDS} value={fieldId} onChange={setFieldId} />
    );
  }
  render(<Harness />);
  const input = openField("age");
  (input as HTMLInputElement).focus();
  assert.match(
    screen.getAllByRole("option").find((option) => option.hasAttribute("data-highlighted"))?.textContent ?? "",
    /Primary Reason/
  );
  fireEvent.keyDown(input, { key: "ArrowDown" });
  assert.match(
    screen.getAllByRole("option").find((option) => option.hasAttribute("data-highlighted"))?.textContent ?? "",
    /Beneficiary/
  );
  fireEvent.keyDown(input, { key: "ArrowUp" });
  assert.match(
    screen.getAllByRole("option").find((option) => option.hasAttribute("data-highlighted"))?.textContent ?? "",
    /Primary Reason/
  );
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  assert.match(fieldTrigger("age").textContent ?? "", new RegExp(BENEFICIARY_ID));
  assert.equal(hiddenValue("age"), BENEFICIARY_ID);

  const again = openField("age");
  fireEvent.change(again, { target: { value: "unmap" } });
  fireEvent.click(screen.getByRole("option", { name: "Unmapped" }));
  assert.match(fieldTrigger("age").textContent ?? "", /Unmapped/);
  assert.equal(hiddenValue("age"), "");
});

test("search in one mapping row does not change another row", () => {
  const ageCalls: string[] = [];
  const reasonCalls: string[] = [];
  render(
    <>
      <GhlFieldMappingSelect canonical="age" fields={FIELDS} value={AGE_ID} onChange={(fieldId) => ageCalls.push(fieldId)} />
      <GhlFieldMappingSelect
        canonical="primary_reason"
        fields={FIELDS}
        value=""
        onChange={(fieldId) => reasonCalls.push(fieldId)}
      />
    </>
  );
  const input = openField("age");
  fireEvent.change(input, { target: { value: "beneficiary" } });
  assert.equal(ageCalls.length, 0);
  assert.equal(reasonCalls.length, 0);
  assert.match(fieldTrigger("primary_reason").textContent ?? "", /Unmapped/);
  assert.equal(hiddenValue("primary_reason"), "");
  assert.equal(hiddenValue("age"), AGE_ID);
});
