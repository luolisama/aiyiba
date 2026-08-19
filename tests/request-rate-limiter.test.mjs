import assert from "node:assert/strict";
import test from "node:test";

import { createRequestRateLimiter } from "../server/request-rate-limiter.mjs";

test("request limiter expires old buckets and stays within its capacity", () => {
  let clock = 1_000;
  const limiter = createRequestRateLimiter({ windowMs: 100, limit: 2, maxEntries: 3, now: () => clock });
  assert.equal(limiter.consume("one"), true);
  assert.equal(limiter.consume("one"), true);
  assert.equal(limiter.consume("one"), false);
  assert.equal(limiter.consume("two"), true);
  assert.equal(limiter.consume("three"), true);
  assert.equal(limiter.consume("four"), true);
  assert.equal(limiter.size(), 3);
  clock += 101;
  assert.equal(limiter.consume("fresh"), true);
  assert.equal(limiter.size(), 1);
});
