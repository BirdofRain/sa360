import assert from "node:assert/strict";
import test from "node:test";

import {
  SAM_TEST_GHL_LOCATION_ID,
  ensureSamTestSurveyTextFields,
  planSamTestSurveyTextFields,
  type SurveyCustomField,
} from "./sam-test-survey-text-fields.js";

const coverageAmount: SurveyCustomField = {
  id: "uzWZSqU9o8n7zgkhF7ru",
  name: "Coverage Amount",
  key: "coverage_amount",
  fieldKey: "contact.coverage_amount",
  dataType: "MONETORY",
  model: "contact",
};

const motivation: SurveyCustomField = {
  id: "motivation-id",
  name: "Motivation",
  key: "motivation",
  fieldKey: "contact.motivation",
  dataType: "TEXT",
  model: "contact",
};

test("plan keeps the money Coverage Amount and does not borrow Motivation", () => {
  const plan = planSamTestSurveyTextFields([coverageAmount, motivation]);
  assert.equal(plan.find((item) => item.sourceAttribute === "desired_coverage")?.action, "create");
  assert.equal(plan.find((item) => item.sourceAttribute === "primary_reason")?.action, "create");
  assert.equal(plan.every((item) => item.id !== coverageAmount.id), true);
  assert.equal(plan.every((item) => item.id !== motivation.id), true);
});

test("plan reuses a compatible text field by meaning", () => {
  const existing: SurveyCustomField[] = [
    {
      id: "reason-id",
      name: "Primary Reason",
      key: "primary_reason",
      fieldKey: "contact.primary_reason",
      dataType: "TEXT",
      model: "contact",
    },
    {
      id: "gender-id",
      name: "Gender",
      key: "gender",
      fieldKey: "contact.gender",
      dataType: "TEXT",
      model: "contact",
    },
    coverageAmount,
  ];
  const plan = planSamTestSurveyTextFields(existing);
  assert.equal(plan.find((item) => item.sourceAttribute === "primary_reason")?.action, "reuse");
  assert.equal(plan.find((item) => item.sourceAttribute === "primary_reason")?.id, "reason-id");
  assert.equal(plan.find((item) => item.sourceAttribute === "sex")?.id, "gender-id");
  assert.equal(plan.find((item) => item.sourceAttribute === "branch_of_service")?.action, "create");
  const loose = planSamTestSurveyTextFields([
    {
      id: "tz",
      name: "Best Timezone",
      key: "timezone",
      fieldKey: "contact.timezone",
      dataType: "TEXT",
      model: "contact",
    },
  ]);
  assert.equal(loose.find((item) => item.sourceAttribute === "best_time_to_call")?.action, "create");
});

test("ensure creates only missing TEXT contact fields on Sam's Test", async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  let created = 0;
  const result = await ensureSamTestSurveyTextFields(SAM_TEST_GHL_LOCATION_ID, {
    apiBase: "https://ghl.example",
    resolveAuth: async () => ({ token: "test-token" }),
    fetchImpl: async (url, init) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      calls.push({ url: String(url), method, body });
      if (method === "GET") {
        return new Response(
          JSON.stringify({
            customFields: [coverageAmount, motivation, { id: "age-id", name: "Age", fieldKey: "contact.age", dataType: "TEXT", model: "contact" }],
          }),
          { status: 200 }
        );
      }
      created += 1;
      assert.deepEqual(body, { name: body.name, dataType: "TEXT", model: "contact" });
      assert.equal(Object.keys(body).sort().join(","), "dataType,model,name");
      return new Response(
        JSON.stringify({
          customField: {
            id: `created-${created}`,
            name: body.name,
            fieldKey: `contact.created_${created}`,
            dataType: "TEXT",
            model: "contact",
          },
        }),
        { status: 201 }
      );
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.fields.length, 7);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.fields.every((field) => field.dataType === "TEXT"), true);
  assert.equal(result.fields.some((field) => field.id === coverageAmount.id), false);
  assert.equal(calls.filter((call) => call.method === "POST").length, 7);
  assert.equal(calls.every((call) => call.url.includes(SAM_TEST_GHL_LOCATION_ID)), true);
  assert.equal(JSON.stringify(calls).includes("test-token"), false);
});

test("plan reports a same-name incompatible type instead of creating it", () => {
  const plan = planSamTestSurveyTextFields([
    {
      id: "reason-dropdown",
      name: "Primary Reason",
      key: "primary_reason",
      fieldKey: "contact.primary_reason",
      dataType: "DROPDOWN",
      model: "contact",
    },
    {
      id: "range-number",
      name: "Desired Coverage Range",
      key: "desired_coverage_range",
      fieldKey: "contact.desired_coverage_range",
      dataType: "NUMERICAL",
      model: "contact",
    },
    {
      id: "gender-id",
      name: "Gender",
      key: "gender",
      fieldKey: "contact.gender",
      dataType: "LARGE_TEXT",
      model: "contact",
    },
  ]);
  const reason = plan.find((item) => item.sourceAttribute === "primary_reason");
  const coverage = plan.find((item) => item.sourceAttribute === "desired_coverage");
  assert.equal(reason?.action, "conflict");
  assert.equal(reason?.conflict?.existingDataType, "DROPDOWN");
  assert.equal(reason?.id, null);
  assert.equal(coverage?.action, "conflict");
  assert.equal(coverage?.conflict?.existingId, "range-number");
  assert.equal(plan.find((item) => item.sourceAttribute === "sex")?.action, "reuse");
  assert.equal(plan.find((item) => item.sourceAttribute === "marital_status")?.action, "create");
});

test("ensure does not post a conflicting name and reports a duplicate-name response", async () => {
  const posted: string[] = [];
  const result = await ensureSamTestSurveyTextFields(SAM_TEST_GHL_LOCATION_ID, {
    apiBase: "https://ghl.example",
    resolveAuth: async () => ({ token: "test-token" }),
    fetchImpl: async (_url, init) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { name?: string } : null;
      if (method === "GET") {
        return new Response(
          JSON.stringify({
            customFields: [
              {
                id: "reason-dropdown",
                name: "Primary Reason",
                fieldKey: "contact.primary_reason",
                dataType: "DROPDOWN",
                model: "contact",
              },
            ],
          }),
          { status: 200 }
        );
      }
      posted.push(body?.name ?? "");
      if (body?.name === "Marital Status") {
        return new Response(JSON.stringify({ message: "Custom field already exists" }), { status: 400 });
      }
      return new Response(
        JSON.stringify({
          customField: {
            id: `created-${posted.length}`,
            name: body?.name,
            fieldKey: "contact.created",
            dataType: "TEXT",
            model: "contact",
          },
        }),
        { status: 201 }
      );
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(posted.includes("Primary Reason"), false);
  assert.equal(posted.filter((name) => name === "Marital Status").length, 1);
  assert.deepEqual(result.conflicts.map((conflict) => conflict.name).sort(), ["Marital Status", "Primary Reason"]);
  assert.equal(result.conflicts.find((conflict) => conflict.name === "Primary Reason")?.existingDataType, "DROPDOWN");
  assert.equal(result.fields.some((field) => field.name === "Primary Reason"), false);
  assert.equal(result.fields.length, 5);
  assert.equal(JSON.stringify(posted).includes("test-token"), false);
});

test("ensure refuses every other location before calling GHL", async () => {
  let called = false;
  const result = await ensureSamTestSurveyTextFields("other-location", {
    resolveAuth: async () => {
      called = true;
      return { token: "nope" };
    },
    fetchImpl: async () => {
      called = true;
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "location_not_allowed");
  assert.equal(called, false);
});
