import assert from "node:assert/strict";
import test from "node:test";

import songsJson from "../app/data/songs.json" with { type: "json" };
import { createTimelineGameManager } from "../server/timeline-game.mjs";

function managerWithClock() {
  let clock = 10_000;
  const manager = createTimelineGameManager({ normal: songsJson, hardcore: songsJson }, {
    now: () => clock,
    randomIndex: () => 0,
    startGraceMs: 0,
    actionIntervalMs: 0,
  });
  return { manager, tick: () => { clock += 1; } };
}

test("time machine keeps the target date private until placement", () => {
  const { manager } = managerWithClock();
  const state = manager.start("normal", "timeline-test-client");
  assert.equal(state.timeline.length, 1);
  assert.equal(state.timeline[0].publicationDate, songsJson.items[0].publicationDate);
  assert.equal(state.target.name, songsJson.items[1].name);
  assert.equal(state.target.publicationDate, undefined);
  assert.equal(state.placements.length, 0);
});

test("time machine reveals and sorts every placed song", () => {
  const { manager, tick } = managerWithClock();
  let state = manager.start("normal", "timeline-place-client");
  for (let turn = 0; turn < 10; turn += 1) {
    tick();
    state = manager.place(state.roundId, 0);
    assert.equal(state.timeline.length, turn + 2);
    assert.ok(state.lastPlacement.song.publicationDate);
  }
  assert.equal(state.finished, true);
  assert.equal(state.target, null);
  assert.equal(state.placements.length, 10);
  assert.equal(state.score, 10);
});

test("a wrong slot scores zero but inserts the work at its real position", () => {
  const { manager } = managerWithClock();
  const started = manager.start("normal", "timeline-wrong-client");
  const state = manager.place(started.roundId, 1);
  assert.equal(state.lastPlacement.correct, false);
  assert.equal(state.placements.at(-1).chosenSlot, 1);
  assert.equal(state.placements.at(-1).correctSlotStart, 0);
  assert.equal(state.placements.at(-1).correctSlotEnd, 0);
  assert.equal(state.score, 0);
  assert.equal(state.timeline[0].bvid, songsJson.items[1].bvid);
  assert.equal(state.timeline[1].bvid, songsJson.items[0].bvid);
});
