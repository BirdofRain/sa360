import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";

const originalLoad = (module as NodeModule & { _load: typeof module._load })._load;
(module as NodeModule & { _load: typeof module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

const originalFetch = globalThis.fetch;
const envSnapshot = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) delete process.env[key];
  }
  Object.assign(process.env, envSnapshot);
}

function enableBulkImports() {
  process.env.NEXT_PUBLIC_SA360_BULK_SOURCE_IMPORTS_ENABLED = "true";
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv();
});

test("formatBulkImportAdminError sanitizes HTML responses", async () => {
  const { formatBulkImportAdminError } = await import("./admin-api.ts");
  const message = formatBulkImportAdminError({
    ok: false,
    status: 500,
    body: '<!DOCTYPE html><html><body>Error</body></html>',
  });
  assert.match(message, /non-JSON response/i);
  assert.match(message, /HTTP 500/);
  assert.match(message, /Verify the C\.O\.C\. API base URL/);
  assert.doesNotMatch(message, /<!DOCTYPE/);
});

test("formatBulkImportAdminError sanitizes invalid JSON marker from admin helper", async () => {
  const { formatBulkImportAdminError } = await import("./admin-api.ts");
  const message = formatBulkImportAdminError({
    ok: false,
    status: 200,
    body: "Invalid JSON from admin API",
  });
  assert.equal(
    message,
    "The SA360 API returned a non-JSON response (HTTP 200). Verify the C.O.C. API base URL."
  );
});

test("getAdminApiKey prefers SA360_ADMIN_API_KEY then ADMIN_API_KEY", async () => {
  const { getAdminApiKey } = await import("@/lib/admin-api/server.ts");
  const prevA = process.env.SA360_ADMIN_API_KEY;
  const prevB = process.env.ADMIN_API_KEY;
  const prevC = process.env.SA360_ADMIN_KEY;
  delete process.env.SA360_ADMIN_API_KEY;
  delete process.env.SA360_ADMIN_KEY;
  process.env.ADMIN_API_KEY = "admin-fallback-key";
  assert.equal(getAdminApiKey(), "admin-fallback-key");

  process.env.SA360_ADMIN_API_KEY = "sa360-primary-key";
  assert.equal(getAdminApiKey(), "sa360-primary-key");

  if (prevA !== undefined) process.env.SA360_ADMIN_API_KEY = prevA;
  else delete process.env.SA360_ADMIN_API_KEY;
  if (prevB !== undefined) process.env.ADMIN_API_KEY = prevB;
  else delete process.env.ADMIN_API_KEY;
  if (prevC !== undefined) process.env.SA360_ADMIN_KEY = prevC;
  else delete process.env.SA360_ADMIN_KEY;
});

test("uploadBulkImportCsvBody uses shared admin API helper with NEXT_PUBLIC_SA360_API_BASE_URL", async () => {
  enableBulkImports();
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.com";
  process.env.SA360_ADMIN_API_KEY = "test-admin-key";

  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({ batch: { id: "batch-123" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const { uploadBulkImportCsvBody } = await import("./admin-api.ts");
  const result = await uploadBulkImportCsvBody({
    fileName: "sa360_bulk_import_acceptance_test.csv",
    csvText: "a,b\n1,2",
    importLabel: "GOATLEAD TEST",
  });

  assert.equal(result.batch.id, "batch-123");
  assert.equal(capturedUrl, "https://api.example.com/admin/v1/bulk-imports/upload");
  assert.equal(capturedInit?.method, "POST");
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers["x-sa360-admin-key"], "test-admin-key");
  const body = JSON.parse(String(capturedInit?.body));
  assert.equal(body.fileName, "sa360_bulk_import_acceptance_test.csv");
  assert.equal(body.importLabel, "GOATLEAD TEST");
});

test("uploadBulkImportCsvBody omits blank importLabel", async () => {
  enableBulkImports();
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.com";
  process.env.ADMIN_API_KEY = "fallback-key";

  let capturedBody = "";
  globalThis.fetch = (async (_input, init) => {
    capturedBody = String(init?.body);
    return new Response(JSON.stringify({ batch: { id: "batch-456" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const { uploadBulkImportCsvBody } = await import("./admin-api.ts");
  await uploadBulkImportCsvBody({
    fileName: "test.csv",
    csvText: "x",
    importLabel: "   ",
  });

  const body = JSON.parse(capturedBody);
  assert.equal(body.importLabel, undefined);
  assert.equal("importLabel" in body, false);
});

test("uploadBulkImportCsvBody HTML response does not throw JSON.parse SyntaxError", async () => {
  enableBulkImports();
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://coc-host.example.com";
  process.env.SA360_ADMIN_API_KEY = "test-key";

  globalThis.fetch = (async () =>
    new Response("<!DOCTYPE html><html><body>500</body></html>", {
      status: 500,
      headers: { "Content-Type": "text/html" },
    })) as typeof fetch;

  const { uploadBulkImportCsvBody } = await import("./admin-api.ts");
  await assert.rejects(
    () =>
      uploadBulkImportCsvBody({
        fileName: "test.csv",
        csvText: "a",
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.doesNotMatch(err.message, /Unexpected token/);
      assert.match(err.message, /non-JSON response/i);
      assert.match(err.message, /Verify the C\.O\.C\. API base URL/);
      return true;
    }
  );
});

test("bulkAdminFetch fails with readable error when API is not configured", async () => {
  enableBulkImports();
  delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
  delete process.env.SA360_ADMIN_API_KEY;
  delete process.env.ADMIN_API_KEY;
  delete process.env.SA360_ADMIN_KEY;

  const { bulkAdminFetch } = await import("./admin-api.ts");
  await assert.rejects(
    () => bulkAdminFetch("/admin/v1/bulk-imports"),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Admin API is not configured/i);
      return true;
    }
  );
});
