import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { maskEmail, maskPhone } from "./mask";

describe("live mask helpers", () => {
  it("masks phone for client role", () => {
    assert.equal(maskPhone("+15125551234", "client"), "(***) ***-1234");
  });

  it("masks email for client role", () => {
    assert.equal(maskEmail("agent@example.com", "client"), "a***@example.com");
  });

  it("shows plainer admin phone mask without full number", () => {
    const masked = maskPhone("+15125551234", "admin");
    assert.ok(masked.includes("***"));
    assert.ok(!masked.includes("5125551234"));
  });
});
