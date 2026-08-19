import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("clue-api-test", `${process.pid}-${Date.now()}`);
process.env.PK_ALLOWED_ORIGINS = "https://aiyiba.getuphole.top,http://localhost:3000";
const { default: worker } = await import(workerUrl.href);

function call(action, payload = {}, origin = "http://localhost:3000", ip = `clue-api-${process.pid}`) {
  return worker.fetch(
    new Request("http://localhost/api/clues", {
      method: "POST",
      headers: { "content-type": "application/json", origin, "x-real-ip": ip },
      body: JSON.stringify({ action, ...payload }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("clue API exposes only the unlocked clue until the round ends", async () => {
  const start = await call("start", { pool: "normal", clientId: `clue-api-${Date.now()}` });
  assert.equal(start.status, 200);
  const started = await start.json();
  assert.equal(started.state.clues.length, 1);
  assert.equal(started.state.answer, undefined);
  assert.equal(started.state.answerBvid, undefined);

  await new Promise((resolve) => setTimeout(resolve, 400));
  const skipped = await call("skip", { roundId: started.state.roundId });
  assert.equal(skipped.status, 200);
  const next = await skipped.json();
  assert.equal(next.state.clues.length, 2);
  assert.equal(next.state.answer, undefined);

  const ended = await call("surrender", { roundId: started.state.roundId });
  assert.equal(ended.status, 200);
  const finished = await ended.json();
  assert.ok(finished.state.answer?.bvid);
});

test("clue API limits active rounds even when client IDs change", async () => {
  const ip = `clue-cap-${process.pid}`;
  const rounds = [];
  for (let index = 0; index < 8; index += 1) {
    const response = await call("start", { clientId: `clue-changing-${index}-${Date.now()}` }, "http://localhost:3000", ip);
    assert.equal(response.status, 200);
    rounds.push((await response.json()).state.roundId);
  }
  const blocked = await call("start", { clientId: `clue-blocked-${Date.now()}` }, "http://localhost:3000", ip);
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, "active_round_limit");
  assert.equal((await call("surrender", { roundId: rounds[0] }, "http://localhost:3000", ip)).status, 200);
  assert.equal((await call("start", { clientId: `clue-released-${Date.now()}` }, "http://localhost:3000", ip)).status, 200);
});

test("clue API separately throttles new rounds", async () => {
  const ip = `clue-start-rate-${process.pid}`;
  const clientId = `clue-restart-${Date.now()}`;
  for (let index = 0; index < 12; index += 1) {
    assert.equal((await call("start", { clientId }, "http://localhost:3000", ip)).status, 200);
  }
  const blocked = await call("start", { clientId }, "http://localhost:3000", ip);
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, "start_rate_limited");
});

test("clue API rejects an unexpected origin", async () => {
  const response = await call("start", { clientId: `clue-origin-${Date.now()}` }, "https://example.invalid");
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "origin_denied");
});
