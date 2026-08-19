import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("timeline-api-test", `${process.pid}-${Date.now()}`);
process.env.PK_ALLOWED_ORIGINS = "https://aiyiba.getuphole.top,http://localhost:3000";
const { default: worker } = await import(workerUrl.href);

function call(action, payload = {}, origin = "http://localhost:3000", ip = `timeline-api-${process.pid}`) {
  return worker.fetch(
    new Request("http://localhost/api/timeline", {
      method: "POST",
      headers: { "content-type": "application/json", origin, "x-real-ip": ip },
      body: JSON.stringify({ action, ...payload }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("timeline API hides the current target date and reveals it after placement", async () => {
  const startedResponse = await call("start", { pool: "normal", clientId: `timeline-api-${Date.now()}` });
  assert.equal(startedResponse.status, 200);
  const started = await startedResponse.json();
  assert.equal(started.state.timeline.length, 1);
  assert.equal(started.state.target.publicationDate, undefined);

  await new Promise((resolve) => setTimeout(resolve, 400));
  const placedResponse = await call("place", { roundId: started.state.roundId, slot: 0 });
  assert.equal(placedResponse.status, 200);
  const placed = await placedResponse.json();
  assert.equal(placed.state.timeline.length, 2);
  assert.ok(placed.state.lastPlacement.song.publicationDate);
});

test("timeline API limits active rounds even when client IDs change", async () => {
  const ip = `timeline-cap-${process.pid}`;
  for (let index = 0; index < 8; index += 1) {
    const response = await call("start", { clientId: `timeline-changing-${index}-${Date.now()}` }, "http://localhost:3000", ip);
    assert.equal(response.status, 200);
  }
  const blocked = await call("start", { clientId: `timeline-blocked-${Date.now()}` }, "http://localhost:3000", ip);
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, "active_round_limit");
});

test("timeline API separately throttles new rounds", async () => {
  const ip = `timeline-start-rate-${process.pid}`;
  const clientId = `timeline-restart-${Date.now()}`;
  for (let index = 0; index < 12; index += 1) {
    assert.equal((await call("start", { clientId }, "http://localhost:3000", ip)).status, 200);
  }
  const blocked = await call("start", { clientId }, "http://localhost:3000", ip);
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, "start_rate_limited");
});

test("timeline API rejects an unexpected origin", async () => {
  const response = await call("start", { clientId: `timeline-origin-${Date.now()}` }, "https://example.invalid");
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "origin_denied");
});
