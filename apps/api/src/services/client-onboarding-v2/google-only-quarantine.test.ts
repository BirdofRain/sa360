import assert from "node:assert/strict";
import test from "node:test";

import {
  operatorOwnedIntake,
  PRODUCTION_INTAKE_PROVIDERS,
  PRODUCTION_INTAKE_SYSTEMS,
  PRODUCTION_INTAKE_TYPES,
} from "./google-only-quarantine.js";

test("every current production intake shape is refused", () => {
  assert.equal(
    operatorOwnedIntake({
      sourceProvider: "manual_import",
      sourceSystem: "external_vendor",
      sourceType: "manual_entry",
      sourceRouteKey: "operator_owned_test",
      webhookRequestLogId: null,
    }),
    false
  );
  for (const sourceProvider of PRODUCTION_INTAKE_PROVIDERS) {
    for (const sourceSystem of PRODUCTION_INTAKE_SYSTEMS) {
      for (const sourceType of PRODUCTION_INTAKE_TYPES) {
        assert.equal(
          operatorOwnedIntake({ sourceProvider, sourceSystem, sourceType, webhookRequestLogId: null }),
          false,
          `${sourceProvider}/${sourceSystem}/${sourceType}`
        );
      }
    }
  }
  assert.equal(
    operatorOwnedIntake({
      sourceProvider: "future_quarantine_route",
      sourceSystem: "future_quarantine_system",
      sourceType: "future_quarantine_type",
    }),
    false
  );
});
