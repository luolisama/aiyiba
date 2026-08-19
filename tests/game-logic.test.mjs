import assert from "node:assert/strict";
import test from "node:test";
import {
  addModeResult,
  comparePublicationDate,
  countTitleCharacters,
  createShoe,
  drawFromShoe,
  getMaxGuesses,
  isValidShoe,
  matchesSongQuery,
  newestFirst,
  normalizeModeStats,
  normalizeSearchText,
  shuffleBvids,
} from "../app/game-logic.mjs";

const firstIndex = () => 0;

test("counts visible title characters while ignoring spaces", () => {
  assert.equal(countTitleCharacters("9Bang15便士"), 9);
  assert.equal(countTitleCharacters("Old Sad Song"), 10);
  assert.equal(countTitleCharacters("你好，世界"), 5);
});

test("matches simplified Chinese aliases for traditional song titles", () => {
  const song = {
    name: "大時代",
    bilibiliTitle: "心华，乐正绫原创《大時代》",
    searchAliases: ["大时代"],
  };

  assert.equal(normalizeSearchText(" 大时代 "), "大时代");
  assert.equal(matchesSongQuery(song, "大时代"), true);
  assert.equal(matchesSongQuery(song, "时代"), true);
  assert.equal(matchesSongQuery(song, "大時代", true), true);
});

test("matches continuous full pinyin for Chinese song titles", () => {
  const song = {
    name: "达拉崩吧",
    bilibiliTitle: "洛天依、言和原创《达拉崩吧》",
    searchPinyin: ["dalabengba"],
  };

  assert.equal(matchesSongQuery(song, "dalabengba"), true);
  assert.equal(matchesSongQuery(song, "da la beng ba"), true);
  assert.equal(matchesSongQuery(song, "dalabengba", true), true);
  assert.equal(matchesSongQuery(song, "dalabeng"), true);
});

test("shows the newest guess first without changing submission order", () => {
  const submitted = ["第一次", "第二次", "第三次"];
  assert.deepEqual(newestFirst(submitted), ["第三次", "第二次", "第一次"]);
  assert.deepEqual(submitted, ["第一次", "第二次", "第三次"]);
});

test("publication dates mark the same year as partial", () => {
  assert.deepEqual(comparePublicationDate("2021-07-07", "2023-05-06"), {
    matches: false,
    sameYear: false,
    tone: "wrong",
    text: "2021-07-07",
    hint: "↑ 更晚",
  });
  assert.deepEqual(comparePublicationDate("2022-05-02", "2022-12-19"), {
    matches: false,
    sameYear: true,
    tone: "partial",
    text: "2022-05-02",
    hint: "↑ 更晚",
  });
  assert.deepEqual(comparePublicationDate("2022-05-02", "2022-05-02"), {
    matches: true,
    sameYear: false,
    tone: "correct",
    text: "2022-05-02",
    hint: undefined,
  });
  assert.equal(getMaxGuesses("normal"), 6);
  assert.equal(getMaxGuesses("hard"), 4);
});

test("migrates legacy stats to normal mode and records modes independently", () => {
  const legacy = { played: 3, wins: 2, streak: 0, bestStreak: 2, distribution: [0, 0, 1, 0, 1, 0] };
  const migrated = normalizeModeStats(null, legacy);
  assert.deepEqual(migrated.normal, legacy);
  assert.equal(migrated.hard.played, 0);

  const updated = addModeResult(migrated, "hard", true, 2);
  assert.deepEqual(updated.normal, legacy);
  assert.equal(updated.hard.played, 1);
  assert.equal(updated.hard.wins, 1);
  assert.equal(updated.hard.distribution[1], 1);
});

test("shuffle returns a permutation without modifying the source", () => {
  const source = ["A", "B", "C", "D"];
  const shuffled = shuffleBvids(source, firstIndex);
  assert.deepEqual(source, ["A", "B", "C", "D"]);
  assert.deepEqual([...shuffled].sort(), source);
});

test("a full shoe draws every song exactly once", () => {
  const pool = Array.from({ length: 70 }, (_, index) => `BV${index}`);
  let shoe = createShoe(pool, [], firstIndex);
  let previous;
  const answers = [];
  for (let index = 0; index < pool.length; index += 1) {
    const draw = drawFromShoe(shoe, pool, previous, firstIndex);
    answers.push(draw.answerBvid);
    previous = draw.answerBvid;
    shoe = draw.shoe;
  }
  assert.equal(new Set(answers).size, 70);
  assert.equal(shoe.remaining.length, 0);
  assert.ok(isValidShoe(shoe, pool));

  const nextCycle = drawFromShoe(shoe, pool, previous, firstIndex);
  assert.notEqual(nextCycle.answerBvid, previous);
});

test("invalid or old pool state is rebuilt without repeating the active answer", () => {
  const pool = ["A", "B", "C"];
  const draw = drawFromShoe({ schemaVersion: 1 }, pool, "B", firstIndex);
  assert.notEqual(draw.answerBvid, "B");
  assert.ok(isValidShoe(draw.shoe, pool));
});
