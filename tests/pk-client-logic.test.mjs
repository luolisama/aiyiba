import assert from "node:assert/strict";
import test from "node:test";

import { buildPkShareText, normalizePkStats, recordPkRound } from "../app/pk/client-logic.mjs";

test("records multiplayer stats by catalog and difficulty and ignores the same round twice", () => {
  const first = recordPkRound(null, {
    roundId: "round-normal-1",
    mode: "normal",
    outcome: "win",
    attempts: 3,
    wonByGuess: true,
  });
  const duplicate = recordPkRound(first, {
    roundId: "round-normal-1",
    mode: "normal",
    outcome: "loss",
    attempts: 6,
  });
  const hard = recordPkRound(duplicate, {
    roundId: "round-hard-1",
    pool: "hardcore",
    mode: "hard",
    outcome: "draw",
    attempts: 4,
  });

  assert.equal(hard.schemaVersion, 5);
  assert.equal(hard.pools.normal.modes.normal.played, 1);
  assert.equal(hard.pools.normal.modes.normal.wins, 1);
  assert.equal(hard.pools.normal.modes.normal.distribution[2], 1);
  assert.equal(hard.pools.normal.modes.hard.played, 0);
  assert.equal(hard.pools.hardcore.modes.hard.played, 1);
  assert.equal(hard.pools.hardcore.modes.hard.draws, 1);
  assert.deepEqual(hard.recordedRoundIds, ["round-normal-1", "round-hard-1"]);
});

test("migrates legacy duel and party stats into the standard catalog", () => {
  const stats = normalizePkStats({
    kinds: {
      duel: { normal: { played: 2, wins: 1, distribution: [1, 1] }, hard: { played: 1 } },
      party: { normal: { played: 3, wins: 2, distribution: [0, 0, 1] }, hard: { played: 1, draws: 1 } },
    },
  });
  assert.equal(stats.schemaVersion, 5);
  assert.equal(stats.pools.normal.modes.normal.played, 5);
  assert.equal(stats.pools.normal.modes.normal.wins, 3);
  assert.equal(stats.pools.normal.modes.normal.distribution[0], 1);
  assert.equal(stats.pools.normal.modes.normal.distribution[2], 1);
  assert.equal(stats.pools.normal.modes.hard.played, 2);
  assert.equal(stats.pools.normal.modes.hard.draws, 1);
  assert.equal(stats.pools.hardcore.modes.normal.played, 0);
});

test("keeps existing catalog-separated stats when reading the current schema", () => {
  const stats = normalizePkStats({
    schemaVersion: 4,
    pools: {
      normal: { modes: { normal: { played: 2, wins: 1 }, hard: { played: 1, draws: 1 } } },
      hardcore: { modes: { normal: { played: 3, losses: 2 }, hard: { played: 4, wins: 4 } } },
    },
  });
  assert.equal(stats.pools.normal.modes.normal.played, 2);
  assert.equal(stats.pools.normal.modes.hard.draws, 1);
  assert.equal(stats.pools.hardcore.modes.normal.losses, 2);
  assert.equal(stats.pools.hardcore.modes.hard.wins, 4);
});

test("normalizes malformed stats into safe defaults", () => {
  const stats = normalizePkStats({
    modes: { normal: { played: -1, wins: 2, distribution: [1, "bad"] } },
    recordedRoundIds: ["same", "same", null],
  });
  assert.equal(stats.pools.normal.modes.normal.played, 0);
  assert.equal(stats.pools.normal.modes.normal.wins, 2);
  assert.deepEqual(stats.pools.normal.modes.normal.distribution, [1, 0, 0, 0, 0, 0]);
  assert.equal(stats.pools.normal.modes.hard.distribution.length, 4);
  assert.equal(stats.pools.hardcore.modes.normal.played, 0);
  assert.deepEqual(stats.recordedRoundIds, ["same"]);
});

test("keeps clue ladder stats separate from classic difficulty stats", () => {
  const clueWin = recordPkRound(null, {
    roundId: "clue-round-1",
    gameType: "clues",
    pool: "hardcore",
    outcome: "win",
    attempts: 2,
    wonByGuess: true,
  });
  assert.equal(clueWin.pools.hardcore.clues.played, 1);
  assert.equal(clueWin.pools.hardcore.clues.wins, 1);
  assert.equal(clueWin.pools.hardcore.clues.distribution[1], 1);
  assert.equal(clueWin.pools.hardcore.modes.normal.played, 0);
  assert.equal(clueWin.games.clues.pools.hardcore.modes.clues.played, 1);
});

test("builds a shareable multiplayer recap with all guess histories", () => {
  const text = buildPkShareText({
    modeLabel: "普通模式",
    kindLabel: "多人模式",
    outcome: "你赢了！",
    answerName: "夜间出租车",
    currentPlayerId: "player-a",
    players: [
      { id: "player-a", name: "甲", guesses: [{ name: "大时代", correct: false }, { name: "夜间出租车", correct: true }] },
      { id: "player-b", name: "乙", guesses: [] },
    ],
  });
  assert.match(text, /哎一把 · 多人模式 · 普通模式/);
  assert.match(text, /答案：夜间出租车/);
  assert.match(text, /我：大时代 → 夜间出租车✓/);
  assert.match(text, /乙：本轮未猜/);
});

test("builds a clue ladder share recap with revealed clues", () => {
  const text = buildPkShareText({
    gameType: "clues",
    kindLabel: "多人模式",
    outcome: "你们并列获胜！",
    answerName: "夜间出租车",
    currentPlayerId: "player-a",
    clues: [{ label: "引擎", value: "VOCALOID" }],
    players: [
      { id: "player-a", name: "甲", clueActions: [{ type: "skip" }, { type: "guess", name: "夜间出租车", correct: true }] },
    ],
  });
  assert.match(text, /线索阶梯/);
  assert.match(text, /线索：引擎 VOCALOID/);
  assert.match(text, /我：跳过 → 夜间出租车✓/);
});
