import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveDataSource } from "./data-source";

describe("resolveDataSource", () => {
  it("returns mock when nothing is live", () => {
    assert.equal(resolveDataSource(0, 8), "mock");
  });

  it("returns live when all cards are live", () => {
    assert.equal(resolveDataSource(8, 8), "live");
  });

  it("returns partial_live for mixed wiring", () => {
    assert.equal(resolveDataSource(3, 8), "partial_live");
  });
});
