import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SA360_DEMO_CUSTOM_FIELD_OPTION_MAP } from "@sa360/shared";
import {
  addOptionAlias,
  buildInitialOptionMap,
  removeOptionAlias,
  Sa360OptionMappingTable,
} from "./sa360-option-mapping-table";
import { DIRECT_DEMO_LOCATION_ID } from "@/lib/direct-delivery-demo/types";

afterEach(() => cleanup());

test("buildInitialOptionMap prefills demo option map for Smart Agent 360 Demo location", () => {
  const map = buildInitialOptionMap({ locationId: DIRECT_DEMO_LOCATION_ID });
  assert.equal(map.sa360_niche_key?.VET, "n_vet");
  assert.equal(map.sa360_lifecycle_stage?.NEW, "new");
});

test("Sa360OptionMappingTable renders mapped and missing rows", () => {
  const { container } = render(
    <Sa360OptionMappingTable
      optionMap={{
        ...SA360_DEMO_CUSTOM_FIELD_OPTION_MAP,
        sa360_routing_status: {
          ...SA360_DEMO_CUSTOM_FIELD_OPTION_MAP.sa360_routing_status,
        },
      }}
      onChange={() => {}}
      customFields={[
        {
          fieldKey: "contact.sa360_routing_status",
          dataType: "SINGLE_OPTIONS",
          picklistOptions: ["none", "assigned"],
        },
      ]}
    />
  );
  const text = container.textContent ?? "";
  assert.match(text, /sa360_routing_status/);
  assert.match(text, /NONE/);
  assert.match(text, /dropdown option mapping/);
});

test("addOptionAlias adds VET -> N_VET while preserving N_VET -> N_VET", () => {
  const next = addOptionAlias(
    { sa360_niche_key: { N_VET: "N_VET" } },
    "sa360_niche_key",
    "VET",
    "N_VET"
  );
  assert.deepEqual(next.sa360_niche_key, { N_VET: "N_VET", VET: "N_VET" });
});

test("addOptionAlias ignores blank source or GHL value", () => {
  const base = { sa360_niche_key: { N_VET: "N_VET" } };
  assert.equal(addOptionAlias(base, "sa360_niche_key", "  ", "N_VET"), base);
  assert.equal(addOptionAlias(base, "sa360_niche_key", "VET", "  "), base);
});

test("removeOptionAlias removes a single alias and drops empty field maps", () => {
  const afterRemoveVet = removeOptionAlias(
    { sa360_niche_key: { VET: "N_VET", N_VET: "N_VET" } },
    "sa360_niche_key",
    "VET"
  );
  assert.deepEqual(afterRemoveVet.sa360_niche_key, { N_VET: "N_VET" });

  const afterRemoveLast = removeOptionAlias(
    { sa360_niche_key: { N_VET: "N_VET" } },
    "sa360_niche_key",
    "N_VET"
  );
  assert.equal("sa360_niche_key" in afterRemoveLast, false);
});

test("Sa360OptionMappingTable add-alias form emits a new alias via onChange", () => {
  let latest: Record<string, Record<string, string>> | null = null;
  const { container } = render(
    <Sa360OptionMappingTable
      optionMap={{ sa360_niche_key: { N_VET: "N_VET" } }}
      onChange={(next) => {
        latest = next;
      }}
      customFields={[
        {
          fieldKey: "contact.sa360_niche_key",
          dataType: "SINGLE_OPTIONS",
          picklistOptions: ["N_VET", "N_FEX"],
        },
      ]}
    />
  );
  const fieldSelect = container.querySelector('[aria-label="Alias field"]') as HTMLSelectElement;
  const sourceInput = container.querySelector('[aria-label="Alias SA360 value"]') as HTMLInputElement;
  const ghlInput = container.querySelector('[aria-label="Alias GHL option"]') as HTMLInputElement;
  assert.ok(fieldSelect && sourceInput && ghlInput, "add-alias controls are rendered");

  fireEvent.change(fieldSelect, { target: { value: "sa360_niche_key" } });
  fireEvent.change(sourceInput, { target: { value: "VET" } });
  fireEvent.change(ghlInput, { target: { value: "N_VET" } });
  const addButton = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === "Add alias"
  );
  assert.ok(addButton, "Add alias button is rendered");
  fireEvent.click(addButton!);

  assert.ok(latest);
  assert.deepEqual(latest!.sa360_niche_key, { N_VET: "N_VET", VET: "N_VET" });
});
