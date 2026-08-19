import { randomBytes } from "node:crypto";

import {
  compareSong,
  createShoe,
  drawFromShoe,
} from "../app/game-logic.mjs";
import { ROUND_INVALIDATED_MESSAGE } from "../app/round-errors.mjs";

export const SINGLEPLAYER_ROUND_TTL_MS = 30 * 60 * 1_000;
export const SINGLEPLAYER_MAX_GUESSES = { normal: 6, hard: 4 };
export const SINGLEPLAYER_GUESS_INTERVAL_MS = 500;
export const SINGLEPLAYER_START_GRACE_MS = 350;

function randomIndex(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new RangeError("maxExclusive must be positive");
  return randomBytes(4).readUInt32BE(0) % maxExclusive;
}

function makeToken() {
  return randomBytes(24).toString("base64url");
}

function publicSong(song) {
  return {
    bvid: song.bvid,
    name: song.name,
    bilibiliTitle: song.bilibiliTitle,
    publicationDate: song.publicationDate,
    vocalists: song.vocalists,
    engines: song.engines,
    workType: song.workType,
    gameRole: song.gameRole,
    views: song.views,
    viewTier: song.viewTier,
    coverUrl: song.coverUrl,
    bilibiliUrl: song.bilibiliUrl,
  };
}

function normalizePool(pool) {
  return pool === "hardcore" || pool === "extended" ? "hardcore" : "normal";
}

function normalizeMode(mode) {
  return mode === "hard" ? "hard" : "normal";
}

function normalizeClientId(value) {
  const clientId = typeof value === "string" ? value.trim().slice(0, 80) : "";
  return clientId.length >= 8 ? clientId : `single-${makeToken()}`;
}

function errorWithStatus(message, status = 400, code = "bad_request") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function createSinglePlayerManager(catalogs, options = {}) {
  const now = options.now ?? (() => Date.now());
  const roundTtlMs = options.roundTtlMs ?? SINGLEPLAYER_ROUND_TTL_MS;
  const guessIntervalMs = options.guessIntervalMs ?? SINGLEPLAYER_GUESS_INTERVAL_MS;
  const startGraceMs = options.startGraceMs ?? SINGLEPLAYER_START_GRACE_MS;
  const chooseIndex = options.randomIndex ?? randomIndex;
  const maxRounds = options.maxRounds ?? 1_000;
  const maxShoes = options.maxShoes ?? 2_000;
  const maxActiveRoundsPerOwner = options.maxActiveRoundsPerOwner ?? 8;
  const rounds = new Map();
  const activeRoundByClient = new Map();
  const shoes = new Map();

  function catalogFor(pool) {
    const normalizedPool = normalizePool(pool);
    const catalog = catalogs[normalizedPool];
    if (!catalog?.items?.length) throw errorWithStatus("题库为空，暂时无法开始", 503, "empty_catalog");
    return { pool: normalizedPool, catalog, songs: catalog.items };
  }

  function getRound(roundId) {
    const round = rounds.get(String(roundId ?? ""));
    if (!round || now() - round.createdAt > roundTtlMs) {
      if (round) {
        rounds.delete(round.roundId);
        if (activeRoundByClient.get(round.clientKey) === round.roundId) activeRoundByClient.delete(round.clientKey);
      }
      throw errorWithStatus(ROUND_INVALIDATED_MESSAGE, 410, "round_expired");
    }
    return round;
  }

  function getClientShoe(pool, clientId, songs) {
    const key = `${pool}:${clientId}`;
    let shoe = shoes.get(key);
    const allBvids = songs.map((song) => song.bvid);
    if (!shoe) shoe = createShoe(allBvids, [], chooseIndex);
    return { key, shoe, allBvids };
  }

  function rowFor(round, bvid, attempt) {
    const guess = round.byBvid.get(bvid);
    const answer = round.answer;
    return {
      bvid,
      attempt,
      correct: bvid === answer.bvid,
      cells: compareSong(guess, answer),
    };
  }

  function stateFor(round) {
    const state = {
      roundId: round.roundId,
      pool: round.pool,
      mode: round.mode,
      maxGuesses: round.maxGuesses,
      guesses: round.guesses.map((bvid, index) => rowFor(round, bvid, index + 1)),
      finished: round.finished,
      won: round.won,
      finishReason: round.finishReason,
      poolProgress: round.poolProgress,
      poolSize: round.songs.length,
    };
    if (round.finished) state.answer = publicSong(round.answer);
    return state;
  }

  function clearActiveRoundsForClient(clientId) {
    for (const [clientKey, roundId] of activeRoundByClient) {
      const round = rounds.get(roundId);
      if (round?.clientId !== clientId) continue;
      rounds.delete(roundId);
      activeRoundByClient.delete(clientKey);
    }
  }

  function activeRoundCountForOwner(ownerKey) {
    if (!ownerKey) return 0;
    let count = 0;
    for (const round of rounds.values()) {
      if (!round.finished && round.ownerKey === ownerKey) count += 1;
    }
    return count;
  }

  function pruneFinishedRounds() {
    if (rounds.size < maxRounds) return;
    for (const [roundId, round] of rounds) {
      if (!round.finished) continue;
      rounds.delete(roundId);
      if (activeRoundByClient.get(round.clientKey) === roundId) activeRoundByClient.delete(round.clientKey);
      if (rounds.size < maxRounds) break;
    }
  }

  function start(poolValue = "normal", modeValue = "normal", clientValue, ownerValue = "") {
    cleanup();
    const { pool, catalog, songs } = catalogFor(poolValue);
    const mode = normalizeMode(modeValue);
    const clientId = normalizeClientId(clientValue);
    // A catalog switch begins a fresh round.  Do not leave the previous
    // catalog's active round occupying server capacity for the same browser.
    clearActiveRoundsForClient(clientId);
    const ownerKey = typeof ownerValue === "string" ? ownerValue.trim().slice(0, 160) : "";
    if (ownerKey && activeRoundCountForOwner(ownerKey) >= maxActiveRoundsPerOwner) {
      throw errorWithStatus("当前网络进行中的单人游戏较多，请先完成已有游戏", 429, "active_round_limit");
    }
    pruneFinishedRounds();
    if (rounds.size >= maxRounds) throw errorWithStatus("当前题目服务繁忙，请稍后再试", 503, "round_capacity");
    const clientKey = `${pool}:${clientId}`;

    const previousAnswer = null;
    const active = getClientShoe(pool, clientId, songs);
    const draw = drawFromShoe(active.shoe, active.allBvids, previousAnswer, chooseIndex);
    shoes.set(active.key, draw.shoe);
    while (shoes.size > maxShoes) shoes.delete(shoes.keys().next().value);
    const byBvid = new Map(songs.map((song) => [song.bvid, song]));
    const answer = byBvid.get(draw.answerBvid);
    const round = {
      roundId: makeToken(),
      pool,
      mode,
      maxGuesses: SINGLEPLAYER_MAX_GUESSES[mode],
      clientKey,
      clientId,
      ownerKey,
      catalog,
      songs,
      byBvid,
      answer,
      guesses: [],
      finished: false,
      won: false,
      finishReason: null,
      createdAt: now(),
      startedAt: now(),
      lastGuessAt: 0,
      poolProgress: draw.shoe.seen.length,
    };
    rounds.set(round.roundId, round);
    activeRoundByClient.set(clientKey, round.roundId);
    return stateFor(round);
  }

  function resume(roundId) {
    return stateFor(getRound(roundId));
  }

  function guess(roundId, bvidValue) {
    const round = getRound(roundId);
    if (round.finished) throw errorWithStatus("本局已经结束", 409, "round_finished");
    const nowValue = now();
    if (nowValue - round.startedAt < startGraceMs) {
      throw errorWithStatus("请等倒计时结束后再猜", 429, "too_fast");
    }
    if (nowValue - round.lastGuessAt < guessIntervalMs) {
      throw errorWithStatus("猜得太快了，请稍等一下", 429, "too_fast");
    }
    const bvid = typeof bvidValue === "string" ? bvidValue.trim() : "";
    if (!round.byBvid.has(bvid)) throw errorWithStatus("这不是有效的题库作品", 400, "invalid_song");
    if (round.guesses.includes(bvid)) throw errorWithStatus("这首作品已经猜过了", 409, "duplicate_guess");
    round.lastGuessAt = nowValue;
    round.guesses.push(bvid);
    const correct = bvid === round.answer.bvid;
    round.won = correct;
    round.finished = correct || round.guesses.length >= round.maxGuesses;
    if (round.finished) round.finishReason = correct ? "guessed" : "attempts";
    return { state: stateFor(round), result: stateFor(round).guesses.at(-1) };
  }

  function surrender(roundId) {
    const round = getRound(roundId);
    if (round.finished) throw errorWithStatus("本局已经结束", 409, "round_finished");
    round.finished = true;
    round.won = false;
    round.finishReason = "surrender";
    return stateFor(round);
  }

  function resetPool(poolValue, clientValue) {
    const pool = normalizePool(poolValue);
    const clientId = normalizeClientId(clientValue);
    shoes.delete(`${pool}:${clientId}`);
    return { pool, poolProgress: 0 };
  }

  function cleanup(current = now()) {
    let removed = 0;
    for (const [roundId, round] of rounds) {
      if (current - round.createdAt <= roundTtlMs) continue;
      rounds.delete(roundId);
      if (activeRoundByClient.get(round.clientKey) === roundId) activeRoundByClient.delete(round.clientKey);
      removed += 1;
    }
    for (const [clientKey, roundId] of activeRoundByClient) {
      if (!rounds.has(roundId)) activeRoundByClient.delete(clientKey);
    }
    return removed;
  }

  return { start, resume, guess, surrender, resetPool, cleanup, roundCount: () => rounds.size, activeRoundCountForOwner };
}
