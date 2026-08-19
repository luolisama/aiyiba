import { randomBytes } from "node:crypto";
import { ROUND_INVALIDATED_MESSAGE } from "../app/round-errors.mjs";

export const TIMELINE_PLACEMENTS = 10;
export const TIMELINE_ROUND_TTL_MS = 30 * 60 * 1_000;
export const TIMELINE_ACTION_INTERVAL_MS = 500;
export const TIMELINE_START_GRACE_MS = 350;

function randomIndex(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new RangeError("maxExclusive must be positive");
  return randomBytes(4).readUInt32BE(0) % maxExclusive;
}

function makeToken() {
  return randomBytes(24).toString("base64url");
}

function normalizePool(value) {
  return value === "hardcore" || value === "extended" ? "hardcore" : "normal";
}

function normalizeClientId(value) {
  const clientId = typeof value === "string" ? value.trim().slice(0, 80) : "";
  return clientId.length >= 8 ? clientId : `timeline-${makeToken()}`;
}

function errorWithStatus(message, status = 400, code = "bad_request") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function compareSongs(left, right) {
  return left.publicationDate.localeCompare(right.publicationDate) || left.bvid.localeCompare(right.bvid);
}

function publicTimelineSong(song) {
  return {
    bvid: song.bvid,
    name: song.name,
    publicationDate: song.publicationDate,
    coverUrl: song.coverUrl,
    bilibiliUrl: song.bilibiliUrl,
  };
}

function publicTarget(song) {
  return song ? { bvid: song.bvid, name: song.name } : null;
}

function pickDistinct(songs, count, chooseIndex) {
  const remaining = [...songs];
  const picked = [];
  while (picked.length < count && remaining.length) {
    picked.push(remaining.splice(chooseIndex(remaining.length), 1)[0]);
  }
  return picked;
}

export function createTimelineGameManager(catalogs, options = {}) {
  const now = options.now ?? (() => Date.now());
  const chooseIndex = options.randomIndex ?? randomIndex;
  const roundTtlMs = options.roundTtlMs ?? TIMELINE_ROUND_TTL_MS;
  const actionIntervalMs = options.actionIntervalMs ?? TIMELINE_ACTION_INTERVAL_MS;
  const startGraceMs = options.startGraceMs ?? TIMELINE_START_GRACE_MS;
  const maxRounds = options.maxRounds ?? 1_000;
  const maxActiveRoundsPerOwner = options.maxActiveRoundsPerOwner ?? 8;
  const rounds = new Map();
  const activeRoundByClient = new Map();

  function catalogFor(poolValue) {
    const pool = normalizePool(poolValue);
    const catalog = catalogs[pool];
    if (!catalog?.items?.length || catalog.items.length < TIMELINE_PLACEMENTS + 1) {
      throw errorWithStatus("题库作品不足，暂时无法开始", 503, "small_catalog");
    }
    return { pool, catalog };
  }

  function getRound(roundId) {
    const round = rounds.get(String(roundId ?? ""));
    if (!round || now() - round.createdAt > roundTtlMs) {
      if (round) {
        rounds.delete(round.roundId);
        if (activeRoundByClient.get(round.clientId) === round.roundId) activeRoundByClient.delete(round.clientId);
      }
      throw errorWithStatus(ROUND_INVALIDATED_MESSAGE, 410, "round_expired");
    }
    return round;
  }

  function stateFor(round, placementResult = null) {
    const state = {
      roundId: round.roundId,
      pool: round.pool,
      maxPlacements: TIMELINE_PLACEMENTS,
      placements: round.placements.map((placement) => ({ ...placement })),
      score: round.score,
      timeline: round.timeline.map(publicTimelineSong),
      target: round.finished ? null : publicTarget(round.targets[round.placements.length]),
      finished: round.finished,
    };
    if (placementResult) state.lastPlacement = placementResult;
    return state;
  }

  function clearActiveRound(clientId) {
    const roundId = activeRoundByClient.get(clientId);
    if (roundId) rounds.delete(roundId);
    activeRoundByClient.delete(clientId);
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
      if (activeRoundByClient.get(round.clientId) === roundId) activeRoundByClient.delete(round.clientId);
      if (rounds.size < maxRounds) break;
    }
  }

  function start(poolValue = "normal", clientValue, ownerValue = "") {
    cleanup();
    const { pool, catalog } = catalogFor(poolValue);
    const clientId = normalizeClientId(clientValue);
    clearActiveRound(clientId);
    const ownerKey = typeof ownerValue === "string" ? ownerValue.trim().slice(0, 160) : "";
    if (ownerKey && activeRoundCountForOwner(ownerKey) >= maxActiveRoundsPerOwner) {
      throw errorWithStatus("当前网络进行中的单人游戏较多，请先完成已有游戏", 429, "active_round_limit");
    }
    pruneFinishedRounds();
    if (rounds.size >= maxRounds) throw errorWithStatus("当前题目服务繁忙，请稍后再试", 503, "round_capacity");
    const selected = pickDistinct(catalog.items, TIMELINE_PLACEMENTS + 1, chooseIndex);
    const round = {
      roundId: makeToken(),
      clientId,
      ownerKey,
      pool,
      timeline: [selected[0]],
      targets: selected.slice(1),
      placements: [],
      score: 0,
      finished: false,
      createdAt: now(),
      startedAt: now(),
      lastActionAt: 0,
    };
    rounds.set(round.roundId, round);
    activeRoundByClient.set(clientId, round.roundId);
    return stateFor(round);
  }

  function resume(roundId) {
    return stateFor(getRound(roundId));
  }

  function place(roundId, slotValue) {
    const round = getRound(roundId);
    if (round.finished) throw errorWithStatus("本局已经结束", 409, "round_finished");
    const current = now();
    if (current - round.startedAt < startGraceMs || current - round.lastActionAt < actionIntervalMs) {
      throw errorWithStatus("操作太快了，请稍等一下", 429, "too_fast");
    }
    const slot = Number(slotValue);
    if (!Number.isInteger(slot) || slot < 0 || slot > round.timeline.length) {
      throw errorWithStatus("请选择时间线上的一个位置", 400, "invalid_slot");
    }
    round.lastActionAt = current;
    const target = round.targets[round.placements.length];
    const sorted = [...round.timeline].sort(compareSongs);
    const earliestSlot = sorted.filter((song) => song.publicationDate < target.publicationDate).length;
    const latestSlot = sorted.filter((song) => song.publicationDate <= target.publicationDate).length;
    const correct = slot >= earliestSlot && slot <= latestSlot;
    const insertedSlot = correct ? slot : latestSlot;
    sorted.splice(insertedSlot, 0, target);
    round.timeline = sorted;
    if (correct) round.score += 1;
    const placement = {
      turn: round.placements.length + 1,
      bvid: target.bvid,
      name: target.name,
      chosenSlot: slot,
      correctSlotStart: earliestSlot,
      correctSlotEnd: latestSlot,
      correct,
      publicationDate: target.publicationDate,
    };
    round.placements.push(placement);
    round.finished = round.placements.length >= TIMELINE_PLACEMENTS;
    const result = {
      correct,
      insertedSlot,
      earliestSlot,
      latestSlot,
      song: publicTimelineSong(target),
    };
    return stateFor(round, result);
  }

  function cleanup(current = now()) {
    let removed = 0;
    for (const [roundId, round] of rounds) {
      if (current - round.createdAt <= roundTtlMs) continue;
      rounds.delete(roundId);
      if (activeRoundByClient.get(round.clientId) === roundId) activeRoundByClient.delete(round.clientId);
      removed += 1;
    }
    return removed;
  }

  return { start, resume, place, cleanup, roundCount: () => rounds.size, activeRoundCountForOwner };
}
