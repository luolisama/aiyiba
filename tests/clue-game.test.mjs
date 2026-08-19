import assert from "node:assert/strict";
import test from "node:test";

import songsJson from "../app/data/songs.json" with { type: "json" };
import { createClueGameManager } from "../server/clue-game.mjs";

function managerWithClock() {
  let clock = 10_000;
  const manager = createClueGameManager({ normal: songsJson, hardcore: songsJson }, {
    now: () => clock,
    randomIndex: (max) => max - 1,
    startGraceMs: 0,
    actionIntervalMs: 0,
  });
  return { manager, tick: (value = 1) => { clock += value; } };
}

test("clue ladder reveals one server-owned clue at a time", () => {
  const { manager } = managerWithClock();
  const state = manager.start("normal", "clue-test-client");
  assert.equal(state.answer, undefined);
  assert.equal(state.clues.length, 1);
  assert.equal(state.clues[0].key, "engine");
  const wrong = manager.guess(state.roundId, songsJson.items[1].bvid);
  assert.equal(wrong.finished, false);
  assert.equal(wrong.clues.length, 2);
  assert.equal(wrong.clues[1].key, "tier");
  assert.equal(wrong.answer, undefined);
});

test("the fifth miss keeps the five existing clues and the sixth miss ends the round", () => {
  const { manager } = managerWithClock();
  let state = manager.start("normal", "skip-test-client");
  for (let index = 0; index < 5; index += 1) state = manager.skip(state.roundId);
  assert.equal(state.finished, false);
  assert.equal(state.actions.length, 5);
  assert.equal(state.clues.length, 5);
  assert.equal(state.clues.at(-1).key, "length");
  assert.equal(state.clues.some((clue) => clue.key === "character"), false);

  state = manager.skip(state.roundId);
  assert.equal(state.finished, true);
  assert.equal(state.won, false);
  assert.equal(state.finishReason, "attempts");
  assert.equal(state.clues.length, 5);
  assert.ok(state.answer?.bvid);
});

test("a correct guess ends immediately and exposes the answer", () => {
  const { manager } = managerWithClock();
  const state = manager.start("normal", "win-test-client");
  const finished = manager.guess(state.roundId, songsJson.items[0].bvid);
  assert.equal(finished.finished, true);
  assert.equal(finished.won, true);
  assert.equal(finished.actions.length, 1);
  assert.equal(finished.answer.bvid, songsJson.items[0].bvid);
});

test("duplicate guesses are rejected", () => {
  const { manager } = managerWithClock();
  const state = manager.start("normal", "duplicate-test-client");
  manager.guess(state.roundId, songsJson.items[1].bvid);
  assert.throws(() => manager.guess(state.roundId, songsJson.items[1].bvid), /已经猜过/);
});
