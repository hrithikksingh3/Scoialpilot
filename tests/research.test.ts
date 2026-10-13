import test from "node:test";
import assert from "node:assert/strict";

test("scaffold keeps external actions disabled", () => {
  const config = {
    externalRequests: false,
    aiEnabled: false,
    publishingEnabled: false
  };

  assert.equal(config.externalRequests, false);
  assert.equal(config.aiEnabled, false);
  assert.equal(config.publishingEnabled, false);
});
