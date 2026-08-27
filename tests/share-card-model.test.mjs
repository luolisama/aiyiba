import assert from "node:assert/strict";
import test from "node:test";

import {
  buildClueShareCardModel,
  buildPkShareCardModel,
  buildSingleShareCardModel,
} from "../app/share-card-model.mjs";
import {
  buildRobotsConfig,
  buildSitemapEntries,
  multiplayerAllowedOriginsFromEnv,
  normalizeSiteOrigin,
  siteOriginFromEnv,
  siteUrl,
  siteVerificationTokenFromEnv,
} from "../app/site-origin.mjs";

const answer = {
  name: "夜间出租车",
  vocalists: ["洛天依"],
  engines: ["VOCALOID"],
  publicationDate: "2019-02-21",
  viewTier: "传说曲",
  views: 2_170_000,
};

test("single-player share card includes the real answer and current guess details", () => {
  const model = buildSingleShareCardModel({
    poolLabel: "标准题库",
    modeLabel: "困难模式",
    won: true,
    finishReason: "guessed",
    maxGuesses: 4,
    answer,
    guesses: [{ cells: [
      { tone: "correct", text: "夜间出租车" },
      { tone: "correct", text: "洛天依" },
      { tone: "correct", text: "VOCALOID" },
      { tone: "correct", text: "5字" },
      { tone: "correct", text: "2019-02-21" },
      { tone: "correct", text: "传说" },
    ] }],
    siteOrigin: "https://fork.example.test/",
  });
  assert.equal(model.outcome, "第 1 次猜中");
  assert.equal(model.answerName, "夜间出租车");
  assert.equal(model.url, "https://fork.example.test/solo");
  assert.match(model.answerMeta, /2019年2月21日/);
  assert.match(model.answerDetail, /217万播放/);
  assert.equal(model.rows[0].title, "夜间出租车");
  assert.deepEqual(model.rows[0].tones, ["correct", "correct", "correct", "correct", "correct", "correct"]);
  assert.deepEqual(model.rows[0].fields.map((field) => [field.label, field.value, field.tone]), [
    ["演唱", "洛天依", "correct"],
    ["引擎", "VOCALOID", "correct"],
    ["字数", "5字", "correct"],
    ["日期", "2019-02-21", "correct"],
    ["等级", "传说", "correct"],
  ]);
});

test("clue share card distinguishes skips from guesses", () => {
  const model = buildClueShareCardModel({
    poolLabel: "扩展题库",
    state: {
      won: false,
      finishReason: "surrender",
      clueCount: 5,
      clues: [{}, {}],
      answer,
      actions: [
        { type: "skip", attempt: 1, correct: false },
        { type: "guess", attempt: 2, name: "葛平之歌", correct: false },
      ],
    },
    siteOrigin: "http://localhost:4173",
  });
  assert.equal(model.outcome, "本轮已放弃");
  assert.equal(model.rows[0].title, "跳过，揭示下一层");
  assert.deepEqual(model.rows.map((row) => row.tones[0]), ["partial", "wrong"]);
  assert.equal(model.url, "http://localhost:4173/clues");
});

test("multiplayer share card keeps each player history and marks the winner", () => {
  const model = buildPkShareCardModel({
    poolLabel: "标准题库",
    modeLabel: "普通模式",
    outcome: "你赢了！",
    answer,
    currentPlayerId: "p1",
    winnerPlayerId: "p1",
    players: [
      { id: "p1", name: "玩家甲", attempts: 2, guesses: [{ name: "大时代" }, { name: "夜间出租车" }] },
      { id: "p2", name: "玩家乙", attempts: 0, guesses: [] },
    ],
    siteOrigin: "https://fork.example.test",
  });
  assert.equal(model.rows[0].label, "玩家甲（我）");
  assert.match(model.rows[0].title, /大时代 → 夜间出租车/);
  assert.match(model.rows[0].detail, /本局胜者/);
  assert.equal(model.rows[1].title, "本轮未猜");
  assert.equal(model.url, "https://fork.example.test/multi");
});

test("multiplayer clue share card includes revealed clues and each player's actions", () => {
  const model = buildPkShareCardModel({
    poolLabel: "扩展题库",
    modeLabel: "普通模式",
    gameType: "clues",
    outcome: "你们并列获胜！",
    answer,
    currentPlayerId: "p1",
    winnerPlayerIds: ["p1", "p2"],
    clues: [
      { label: "引擎", value: "VOCALOID" },
      { label: "投稿年份", value: "2019" },
    ],
    players: [
      { id: "p1", name: "玩家甲", attempts: 2, clueActions: [{ stage: 1, type: "skip" }, { stage: 2, type: "guess", name: "夜间出租车" }] },
      { id: "p2", name: "玩家乙", attempts: 2, clueActions: [{ stage: 1, type: "skip" }, { stage: 2, type: "guess", name: "夜间出租车" }] },
    ],
  });
  assert.match(model.gameLabel, /线索阶梯/);
  assert.match(model.outcomeDetail, /引擎 VOCALOID/);
  assert.match(model.rows[0].title, /第1层跳过 → 夜间出租车/);
  assert.match(model.rows[1].detail, /本局胜者/);
});

test("site origins normalize, reject paths, and drive metadata URLs", () => {
  assert.equal(siteOriginFromEnv(undefined), "https://aiyiba.getuphole.top");
  assert.deepEqual(multiplayerAllowedOriginsFromEnv(undefined, "https://fork.example.test"), ["https://fork.example.test"]);
  assert.deepEqual(multiplayerAllowedOriginsFromEnv("https://allowed.example.test, https://second.example.test", "https://fork.example.test"), [
    "https://allowed.example.test",
    "https://second.example.test",
  ]);
  assert.equal(normalizeSiteOrigin("https://example.test/"), "https://example.test");
  assert.equal(siteUrl("http://127.0.0.1:3000", "/solo"), "http://127.0.0.1:3000/solo");
  assert.deepEqual(buildSitemapEntries("https://fork.example.test").map((entry) => entry.url), [
    "https://fork.example.test/",
    "https://fork.example.test/solo",
    "https://fork.example.test/clues",
    "https://fork.example.test/timeline",
    "https://fork.example.test/multi",
  ]);
  assert.deepEqual(buildRobotsConfig("https://fork.example.test"), {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/pk/ws"] },
    sitemap: "https://fork.example.test/sitemap.xml",
  });
  assert.throws(() => normalizeSiteOrigin("https://example.test/path"), /without a path/);
  assert.throws(() => normalizeSiteOrigin("ftp://example.test"), /absolute http\(s\) origin/);
});

test("site verification tokens are optional and reject unsafe values", () => {
  assert.equal(siteVerificationTokenFromEnv(undefined, "GOOGLE_SITE_VERIFICATION"), undefined);
  assert.equal(siteVerificationTokenFromEnv("  abc_DEF-123  ", "GOOGLE_SITE_VERIFICATION"), "abc_DEF-123");
  assert.throws(
    () => siteVerificationTokenFromEnv("<meta name=verification>", "GOOGLE_SITE_VERIFICATION"),
    /GOOGLE_SITE_VERIFICATION/,
  );
});
