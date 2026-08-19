import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("singleplayer-api-test", `${process.pid}-${Date.now()}`);
process.env.PK_ALLOWED_ORIGINS = "https://aiyiba.getuphole.top,http://localhost:3000";
const { default: worker } = await import(workerUrl.href);

function call(action, payload = {}, headers = {}) {
  return worker.fetch(
    new Request("http://localhost/api/singleplayer", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-real-ip": `singleplayer-api-test-${process.pid}`,
        ...headers,
      },
      body: JSON.stringify({ action, ...payload }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("single-player API keeps the answer private until the round ends", async () => {
  const clientId = `api-test-${process.pid}-${Date.now()}`;
  const startResponse = await call("start", { pool: "normal", mode: "normal", clientId });
  assert.equal(startResponse.status, 200);
  const started = await startResponse.json();
  assert.ok(started.state.roundId);
  assert.equal(started.state.answer, undefined);
  assert.equal(started.state.answerBvid, undefined);

  const finishedResponse = await call("surrender", { roundId: started.state.roundId });
  assert.equal(finishedResponse.status, 200);
  const finished = await finishedResponse.json();
  assert.equal(finished.state.finished, true);
  assert.ok(finished.state.answer?.bvid);
  assert.equal(finished.state.answerBvid, undefined);
});

test("single-player API rejects an unexpected origin", async () => {
  const response = await call("start", { clientId: `origin-test-${Date.now()}` }, { origin: "https://example.invalid" });
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.code, "origin_denied");
});

test("single-player API limits active rounds even when client IDs change", async () => {
  const ip = `singleplayer-cap-${process.pid}`;
  const rounds = [];
  for (let index = 0; index < 8; index += 1) {
    const response = await call("start", { clientId: `changing-client-${index}-${Date.now()}` }, { "x-real-ip": ip });
    assert.equal(response.status, 200);
    rounds.push((await response.json()).state.roundId);
  }
  const blocked = await call("start", { clientId: `changing-client-blocked-${Date.now()}` }, { "x-real-ip": ip });
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, "active_round_limit");
  assert.equal((await call("surrender", { roundId: rounds[0] }, { "x-real-ip": ip })).status, 200);
  assert.equal((await call("start", { clientId: `changing-client-released-${Date.now()}` }, { "x-real-ip": ip })).status, 200);
});

test("single-player API separately throttles new rounds", async () => {
  const ip = `singleplayer-start-rate-${process.pid}`;
  const clientId = `singleplayer-restart-${Date.now()}`;
  for (let index = 0; index < 12; index += 1) {
    assert.equal((await call("start", { clientId }, { "x-real-ip": ip })).status, 200);
  }
  const blocked = await call("start", { clientId }, { "x-real-ip": ip });
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, "start_rate_limited");
});
