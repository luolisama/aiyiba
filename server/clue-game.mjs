import { randomBytes } from "node:crypto";

import {
  createShoe,
  drawFromShoe,
} from "../app/game-logic.mjs";
import { ROUND_INVALIDATED_MESSAGE } from "../app/round-errors.mjs";
import { CLUE_COUNT, CLUE_MAX_ATTEMPTS, clueDefinitions } from "./clue-rules.mjs";

export const CLUE_ROUND_TTL_MS = 30 * 60 * 1_000;
export const CLUE_ACTION_INTERVAL_MS = 500;
export const CLUE_START_GRACE_MS = 350;

function randomIndex(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new RangeError("maxExclusive must be positive");
  return randomBytes(4).readUInt32BE(0) % maxExclusive;
}

function makeToken() {
  return randomBytes(24).toString("base64url");
}

function normalizePool(pool) {
  return pool === "hardcore" || pool === "extended" ? "hardcore" : "normal";
}

function normalizeClientId(value) {
  const clientId = typeof value === "string" ? value.trim().slice(0, 80) : "";
  return clientId.length >= 8 ? clientId : `clue-${makeToken()}`;
}

function errorWithStatus(message, status = 400, code = "bad_request") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function publicSong(song) {
  return {
    bvid: song.bvid,
    name: song.name,
    bilibiliTitle: song.bilibiliTitle,
    publicationDate: song.publicationDate,
    vocalists: song.vocalists,
    engines: song.engines,
    views: song.views,
    viewTier: song.viewTier,
    coverUrl: song.coverUrl,
    bilibiliUrl: song.bilibiliUrl,
  };
}

export function createClueGameManager(catalogs, options = {}) {
  const now = options.now ?? (() => Date.now());
  const roundTtlMs = options.roundTtlMs ?? CLUE_ROUND_TTL_MS;
  const actionIntervalMs = options.actionIntervalMs ?? CLUE_ACTION_INTERVAL_MS;
  const startGraceMs = options.startGraceMs ?? CLUE_START_GRACE_MS;
  const chooseIndex = options.randomIndex ?? randomIndex;
  const maxRounds = options.maxRounds ?? 1_000;
  const maxShoes = options.maxShoes ?? 2_000;
  const maxActiveRoundsPerOwner = options.maxActiveRoundsPerOwner ?? 8;
  const rounds = new Map();
  const activeRoundByClient = new Map();
  const shoes = new Map();

  function catalogFor(poolValue) {
    const pool = normalizePool(poolValue);
    const catalog = catalogs[pool];
    if (!catalog?.items?.length) throw errorWithStatus("题库为空，暂时无法开始", 503, "empty_catalog");
    return { pool, catalog, songs: catalog.items };
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

  function stateFor(round) {
    const unlockedCount = Math.min(CLUE_COUNT, round.actions.length + (round.finished && round.won ? 0 : 1));
    const state = {
      roundId: round.roundId,
      pool: round.pool,
      maxAttempts: CLUE_MAX_ATTEMPTS,
      clueCount: CLUE_COUNT,
      clues: round.clues.slice(0, unlockedCount),
      actions: round.actions.map((action) => ({ ...action })),
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

  function start(poolValue = "normal", clientValue, ownerValue = "") {
    cleanup();
    const { pool, catalog, songs } = catalogFor(poolValue);
    const clientId = normalizeClientId(clientValue);
    clearActiveRoundsForClient(clientId);
    const ownerKey = typeof ownerValue === "string" ? ownerValue.trim().slice(0, 160) : "";
    if (ownerKey && activeRoundCountForOwner(ownerKey) >= maxActiveRoundsPerOwner) {
      throw errorWithStatus("当前网络进行中的单人游戏较多，请先完成已有游戏", 429, "active_round_limit");
    }
    pruneFinishedRounds();
    if (rounds.size >= maxRounds) throw errorWithStatus("当前题目服务繁忙，请稍后再试", 503, "round_capacity");
    const clientKey = `${pool}:${clientId}`;
    const shoeKey = clientKey;
    const allBvids = songs.map((song) => song.bvid);
    const draw = drawFromShoe(shoes.get(shoeKey) ?? createShoe(allBvids, [], chooseIndex), allBvids, null, chooseIndex);
    shoes.set(shoeKey, draw.shoe);
    while (shoes.size > maxShoes) shoes.delete(shoes.keys().next().value);
    const byBvid = new Map(songs.map((song) => [song.bvid, song]));
    const answer = byBvid.get(draw.answerBvid);
    const round = {
      roundId: makeToken(),
      pool,
      clientKey,
      clientId,
      ownerKey,
      catalog,
      songs,
      byBvid,
      answer,
      clues: clueDefinitions(answer),
      actions: [],
      finished: false,
      won: false,
      finishReason: null,
      createdAt: now(),
      startedAt: now(),
      lastActionAt: 0,
      poolProgress: draw.shoe.seen.length,
    };
    rounds.set(round.roundId, round);
    activeRoundByClient.set(clientKey, round.roundId);
    return stateFor(round);
  }

  function resume(roundId) {
    return stateFor(getRound(roundId));
  }

  function assertActionAllowed(round) {
    if (round.finished) throw errorWithStatus("本局已经结束", 409, "round_finished");
    const current = now();
    if (current - round.startedAt < startGraceMs) throw errorWithStatus("请稍等一下再操作", 429, "too_fast");
    if (current - round.lastActionAt < actionIntervalMs) throw errorWithStatus("操作太快了，请稍等一下", 429, "too_fast");
    round.lastActionAt = current;
  }

  function finishAfterAction(round, correct) {
    round.won = correct;
    round.finished = correct || round.actions.length >= CLUE_MAX_ATTEMPTS;
    if (round.finished) round.finishReason = correct ? "guessed" : "attempts";
  }

  function guess(roundId, bvidValue) {
    const round = getRound(roundId);
    assertActionAllowed(round);
    const bvid = typeof bvidValue === "string" ? bvidValue.trim() : "";
    const song = round.byBvid.get(bvid);
    if (!song) throw errorWithStatus("这不是有效的题库作品", 400, "invalid_song");
    if (round.actions.some((action) => action.type === "guess" && action.bvid === bvid)) {
      throw errorWithStatus("这首作品已经猜过了", 409, "duplicate_guess");
    }
    const correct = bvid === round.answer.bvid;
    round.actions.push({ type: "guess", attempt: round.actions.length + 1, bvid, name: song.name, correct });
    finishAfterAction(round, correct);
    return stateFor(round);
  }

  function skip(roundId) {
    const round = getRound(roundId);
    assertActionAllowed(round);
    round.actions.push({ type: "skip", attempt: round.actions.length + 1, correct: false });
    finishAfterAction(round, false);
    return stateFor(round);
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

  return { start, resume, guess, skip, surrender, resetPool, cleanup, roundCount: () => rounds.size, activeRoundCountForOwner };
}
