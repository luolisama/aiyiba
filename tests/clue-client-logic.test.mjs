import assert from "node:assert/strict";
import test from "node:test";

import { buildClueShareText, normalizeClueStats, recordClueResult, resetCluePoolStats } from "../app/clues/client-logic.mjs";
import { matchesSongQuery } from "../app/game-logic.mjs";
import normalIndex from "../app/data/clue-search-songs.json" with { type: "json" };
import extendedIndex from "../app/data/hardcore-clue-search-songs.json" with { type: "json" };

test("clue statistics stay separated by catalog and deduplicate rounds", () => {
  let stats = normalizeClueStats();
  stats = recordClueResult(stats, { roundId: "one", pool: "normal", won: true, step: 3 });
  stats = recordClueResult(stats, { roundId: "one", pool: "normal", won: true, step: 3 });
  stats = recordClueResult(stats, { roundId: "two", pool: "hardcore", won: false, step: 6 });
  assert.equal(stats.pools.normal.played, 1);
  assert.equal(stats.pools.normal.distribution[2], 1);
  assert.equal(stats.pools.hardcore.played, 1);
  assert.equal(stats.pools.hardcore.wins, 0);
});

test("resetting clue statistics affects only the selected catalog", () => {
  let stats = normalizeClueStats();
  stats = recordClueResult(stats, { roundId: "normal-round", pool: "normal", won: true, step: 2 });
  stats = recordClueResult(stats, { roundId: "extended-round", pool: "hardcore", won: true, step: 4 });

  const reset = resetCluePoolStats(stats, "normal");
  assert.equal(reset.pools.normal.played, 0);
  assert.equal(reset.pools.normal.wins, 0);
  assert.deepEqual(reset.pools.normal.distribution, [0, 0, 0, 0, 0, 0]);
  assert.equal(reset.pools.hardcore.played, 1);
  assert.equal(reset.pools.hardcore.wins, 1);
  assert.deepEqual(reset.recordedRoundIds, ["normal-round", "extended-round"]);
});

test("clue share includes revealed values, attempts, and the answer", () => {
  const text = buildClueShareText({
    poolLabel: "标准题库",
    state: {
      won: true,
      finishReason: "guessed",
      clues: [{ label: "引擎", value: "VOCALOID" }],
      actions: [{ type: "guess", attempt: 1, name: "达拉崩吧", correct: true }],
      answer: { name: "达拉崩吧" },
    },
    siteOrigin: "https://fork.example.test",
  });
  assert.match(text, /第 1\/6 次猜中/);
  assert.match(text, /引擎：VOCALOID/);
  assert.match(text, /答案：达拉崩吧/);
  assert.match(text, /https:\/\/fork\.example\.test\/clues/);
});

test("browser clue search indexes contain only reduced search metadata", () => {
  assert.equal(normalIndex.itemCount, 70);
  assert.equal(extendedIndex.itemCount, 81);
  for (const song of [...normalIndex.items, ...extendedIndex.items]) {
    assert.ok(Object.keys(song).every((key) => ["bvid", "name", "searchAliases"].includes(key)));
    if (song.searchAliases !== undefined) {
      assert.ok(Array.isArray(song.searchAliases));
      assert.ok(song.searchAliases.every((alias) => typeof alias === "string" && alias.length > 0));
    }
  }
});

test("clue search reuses classic title aliases", () => {
  const song = normalIndex.items.find((item) => item.name === "大時代");
  assert.ok(song);
  assert.deepEqual(song.searchAliases, ["大时代"]);
  assert.equal(matchesSongQuery(song, "大时代"), true);
});
