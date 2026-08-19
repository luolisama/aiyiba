import assert from "node:assert/strict";
import test from "node:test";

import songsJson from "../app/data/songs.json" with { type: "json" };
import { createSinglePlayerManager } from "../server/singleplayer-game.mjs";

function makeManager() {
  let clock = 10_000;
  const manager = createSinglePlayerManager({ normal: songsJson, hardcore: songsJson }, {
    now: () => clock,
    randomIndex: (max) => max - 1,
    startGraceMs: 0,
    guessIntervalMs: 0,
  });
  return { manager, advance(value) { clock += value; } };
}

test("single-player state never exposes the active answer", () => {
  const { manager } = makeManager();
  const state = manager.start("normal", "normal", "single-test-client");
  assert.equal(state.answer, undefined);
  assert.equal(state.answerBvid, undefined);
  const active = manager.resume(state.roundId);
  assert.equal(active.answer, undefined);
  assert.equal(active.answerBvid, undefined);
});

test("single-player server returns authoritative feedback and answer only at the end", () => {
  const { manager } = makeManager();
  const state = manager.start("normal", "normal", "single-test-client");
  const answer = songsJson.items[0].bvid;
  const wrong = songsJson.items[1].bvid;
  const wrongResult = manager.guess(state.roundId, wrong);
  assert.equal(wrongResult.state.finished, false);
  assert.equal(wrongResult.state.guesses.length, 1);
  assert.equal(wrongResult.state.answer, undefined);
  assert.equal(wrongResult.result.cells.length, 6);

  const win = manager.guess(state.roundId, answer);
  assert.equal(win.state.finished, true);
  assert.equal(win.state.won, true);
  assert.equal(win.state.answer.bvid, answer);
});

test("single-player rejects machine-speed guesses", () => {
  let clock = 10_000;
  const manager = createSinglePlayerManager({ normal: songsJson }, {
    now: () => clock,
    randomIndex: (max) => max - 1,
    startGraceMs: 300,
    guessIntervalMs: 500,
  });
  const state = manager.start("normal", "normal", "speed-test-client");
  assert.throws(() => manager.guess(state.roundId, songsJson.items[1].bvid), /倒计时/);
  clock += 301;
  manager.guess(state.roundId, songsJson.items[1].bvid);
  assert.throws(() => manager.guess(state.roundId, songsJson.items[2].bvid), /太快/);
  clock += 500;
  assert.doesNotThrow(() => manager.guess(state.roundId, songsJson.items[2].bvid));
});

test("expired single-player rounds are removed", () => {
  let clock = 10_000;
  const manager = createSinglePlayerManager({ normal: songsJson }, {
    now: () => clock,
    roundTtlMs: 100,
    randomIndex: (max) => max - 1,
  });
  manager.start("normal", "normal", "cleanup-test-client");
  clock += 101;
  assert.equal(manager.cleanup(), 1);
  assert.equal(manager.roundCount(), 0);
});

test("switching catalog replaces the same browser's active round", () => {
  const { manager } = makeManager();
  const normalRound = manager.start("normal", "normal", "catalog-switch-client");
  const extendedRound = manager.start("extended", "hard", "catalog-switch-client");

  assert.equal(extendedRound.pool, "hardcore");
  assert.equal(extendedRound.mode, "hard");
  assert.equal(manager.roundCount(), 1);
  assert.throws(() => manager.resume(normalRound.roundId), /由于推送了一个热更新，本局已失效，请刷新后继续游玩/);
});

test("normal mode keeps all six attempts without revealing title characters", () => {
  const { manager } = makeManager();
  const state = manager.start("normal", "normal", "hint-test-client");
  let latest;
  for (const song of songsJson.items.slice(1, 6)) latest = manager.guess(state.roundId, song.bvid);
  assert.equal(latest.state.guesses.length, 5);
  assert.equal(latest.state.finished, false);
  assert.equal(latest.state.maxGuesses, 6);
  assert.equal("titleHints" in latest.state.guesses.at(-1), false);
});
