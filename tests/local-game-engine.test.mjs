import assert from "node:assert/strict";
import test from "node:test";

import songsJson from "../app/data/songs.json" with { type: "json" };
import hardcoreSongsJson from "../app/data/hardcore-songs.json" with { type: "json" };
import {
  actClue,
  createClassicRound,
  createClueRound,
  createLocalShoe,
  createTimelineRound,
  guessClassic,
  placeTimeline,
  readLocalShoe,
  restoreClassicRound,
  restoreClueRound,
  restoreTimelineRound,
  surrenderClassic,
} from "../app/local-game-engine.mjs";

const normal = songsJson.items;
const extended = hardcoreSongsJson.items;
const firstIndex = () => 0;

test("classic local rounds draw, compare, restore, surrender, and respect hard attempts", () => {
  const created = createClassicRound({ pool: "normal", mode: "hard", songs: normal, nextIndex: firstIndex });
  const answer = created.state.answerBvid;
  const wrong = normal.find((song) => song.bvid !== answer).bvid;
  let state = guessClassic(created.state, normal, wrong);
  assert.equal(state.guesses.length, 1);
  assert.equal(state.finished, false);
  state = guessClassic(state, normal, normal.find((song) => song.bvid !== answer && song.bvid !== state.guessBvids[0]).bvid);
  assert.equal(state.guesses.at(-1).cells.length, 6);
  assert.equal(restoreClassicRound(state, normal).answer, undefined);
  assert.equal(restoreClassicRound(state, normal, "hardcore"), null);
  for (const song of normal) {
    if (state.finished) break;
    if (!state.guessBvids.includes(song.bvid) && song.bvid !== answer) state = guessClassic(state, normal, song.bvid);
  }
  assert.equal(state.finished, true);
  assert.equal(state.finishReason, "attempts");
  assert.equal(state.guesses.length, 4);
  const surrendered = surrenderClassic(created.state, normal);
  assert.equal(surrendered.finishReason, "surrender");
  assert.equal(surrendered.answer.bvid, answer);
});

test("clue local rounds reveal five clues, reject duplicates, and end on the sixth action", () => {
  const created = createClueRound({ pool: "normal", songs: normal, nextIndex: firstIndex });
  let state = created.state;
  assert.equal(state.clues.length, 1);
  const wrong = normal.find((song) => song.bvid !== state.answerBvid).bvid;
  state = actClue(state, normal, "guess", wrong);
  assert.throws(() => actClue(state, normal, "guess", wrong), /已经猜过/);
  for (let index = 1; index < 5; index += 1) state = actClue(state, normal, "skip");
  assert.equal(state.actions.length, 5);
  assert.equal(state.clues.length, 5);
  assert.equal(state.finished, false);
  state = actClue(state, normal, "skip");
  assert.equal(state.finished, true);
  assert.equal(state.finishReason, "attempts");
  assert.equal(state.answer.bvid, state.answerBvid);
  assert.equal(restoreClueRound(state, normal).clues.length, 5);
  assert.equal(restoreClueRound(state, normal, "hardcore"), null);
});

test("timeline local rounds place ten works and preserve wrong-slot feedback", () => {
  let state = createTimelineRound({ pool: "normal", songs: normal, nextIndex: firstIndex });
  for (let turn = 0; turn < 10; turn += 1) {
    const target = normal.find((song) => song.bvid === state.targetBvids[state.placements.length]);
    const sorted = [...state.timeline].sort((left, right) => left.publicationDate.localeCompare(right.publicationDate) || left.bvid.localeCompare(right.bvid));
    const earliest = sorted.filter((song) => song.publicationDate < target.publicationDate).length;
    state = placeTimeline(state, normal, earliest);
    assert.ok(state.lastPlacement);
  }
  assert.equal(state.finished, true);
  assert.equal(state.placements.length, 10);
  assert.equal(restoreTimelineRound(state, normal).finished, true);
  const compactState = { ...state, timeline: state.timeline.map((song) => song.bvid), target: null, lastPlacement: undefined };
  assert.equal(restoreTimelineRound(compactState, normal).finished, true);
  assert.equal(restoreTimelineRound(state, normal, "hardcore"), null);

  let wrongState = createTimelineRound({ pool: "normal", songs: normal, nextIndex: firstIndex });
  const target = normal.find((song) => song.bvid === wrongState.targetBvids[0]);
  const sorted = [...wrongState.timeline].sort((left, right) => left.publicationDate.localeCompare(right.publicationDate) || left.bvid.localeCompare(right.bvid));
  const earliest = sorted.filter((song) => song.publicationDate < target.publicationDate).length;
  const wrongSlot = earliest === 0 ? 1 : 0;
  wrongState = placeTimeline(wrongState, normal, wrongSlot);
  assert.equal(wrongState.lastPlacement.correct, false);
  assert.equal(wrongState.score, 0);
});

test("standard and extended local shoes stay isolated and legacy rounds are discarded", () => {
  const normalIds = normal.map((song) => song.bvid);
  const extendedIds = extended.map((song) => song.bvid);
  const shoe = createLocalShoe(normalIds, [], firstIndex);
  assert.ok(readLocalShoe(JSON.stringify(shoe), normalIds));
  assert.equal(readLocalShoe(JSON.stringify(shoe), extendedIds), null);
  assert.equal(restoreClassicRound({ schemaVersion: 4, roundId: "old" }, normal), null);
  assert.equal(restoreClueRound({ schemaVersion: 1, roundId: "old" }, normal), null);
  assert.equal(restoreTimelineRound({ schemaVersion: 1, roundId: "old" }, normal), null);
});
