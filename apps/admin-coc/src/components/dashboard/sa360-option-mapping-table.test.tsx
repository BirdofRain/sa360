import test from "node:test";
import assert from "node:assert/strict";
import { render, screen } from "@testing-library/react";
import { SA360_DEMO_CUSTOM_FIELD_OPTION_MAP } from "@sa360/shared";
import {
  buildInitialOptionMap,
  Sa360OptionMappingTable,
} from "./sa360-option-mapping-table";
import { DIRECT_DEMO_LOCATION_ID } from "@/lib/direct-delivery-demo/types";

test("buildInitialOptionMap prefills demo option map for Smart Agent 360 Demo location", () => {
  const map = buildInitialOptionMap({ locationId: DIRECT_DEMO_LOCATION_ID });
  assert.equal(map.sa360_niche_key?.VET, "n_vet");
  assert.equal(map.sa360_lifecycle_stage?.NEW, "new");
});

test("Sa360OptionMappingTable renders mapped and missing rows", () => {
  render(
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
  assert.ok(screen.getByText("sa360_routing_status"));
  assert.ok(screen.getByText("NONE"));
  assert.ok(screen.getByText("dropdown option mapping"));
});
