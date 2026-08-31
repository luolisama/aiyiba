import {
  compareSong,
  countTitleCharacters,
  createShoe,
  drawFromShoe,
  formatTier,
  isValidShoe,
  secureRandomIndex,
} from "./game-logic.mjs";
import { CLUE_COUNT, CLUE_MAX_ATTEMPTS, clueDefinitions } from "./clue-rules.mjs";

export const LOCAL_CLASSIC_SCHEMA_VERSION = 5;
export const LOCAL_CLUE_SCHEMA_VERSION = 2;
export const LOCAL_TIMELINE_SCHEMA_VERSION = 2;
export const CLASSIC_MAX_GUESSES = { normal: 6, hard: 4 };
export const TIMELINE_PLACEMENTS = 10;

function roundId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizePool(value) {
  return value === "hardcore" || value === "extended" ? "hardcore" : "normal";
}

function normalizeMode(value) {
  return value === "hard" ? "hard" : "normal";
}

function byBvid(songs) {
  return new Map(songs.map((song) => [song.bvid, song]));
}

function answerFor(state, songs) {
  return byBvid(songs).get(state.answerBvid);
}

function copyShoe(shoe) {
  return shoe ? {
    ...shoe,
    remaining: [...shoe.remaining],
    seen: [...shoe.seen],
    recent: Array.isArray(shoe.recent) ? [...shoe.recent] : [],
  } : shoe;
}

export function readLocalShoe(raw, allBvids) {
  try {
    const shoe = typeof raw === "string" ? JSON.parse(raw) : raw;
    return isValidShoe(shoe, allBvids) ? copyShoe(shoe) : null;
  } catch {
    return null;
  }
}

export function createLocalShoe(allBvids, seenBvids = [], nextIndex = secureRandomIndex) {
  return createShoe(allBvids, seenBvids, nextIndex);
}

export function drawLocalAnswer(shoe, allBvids, nextIndex = secureRandomIndex) {
  return drawFromShoe(shoe, allBvids, null, nextIndex);
}

export function classicView(state, songs) {
  const catalog = byBvid(songs);
  const answer = catalog.get(state.answerBvid);
  if (!answer) return null;
  const guesses = state.guessBvids.map((bvid, index) => {
    const guess = catalog.get(bvid);
    return {
      bvid,
      attempt: index + 1,
      correct: bvid === answer.bvid,
      cells: compareSong(guess, answer),
    };
  });
  return {
    ...state,
    guesses,
    ...(state.finished ? { answer } : {}),
  };
}

export function createClassicRound({ pool = "normal", mode = "normal", songs, shoe = null, nextIndex = secureRandomIndex }) {
  const allBvids = songs.map((song) => song.bvid);
  const draw = drawFromShoe(readLocalShoe(shoe, allBvids) ?? createShoe(allBvids, [], nextIndex), allBvids, null, nextIndex);
  const state = {
    schemaVersion: LOCAL_CLASSIC_SCHEMA_VERSION,
    roundId: roundId("solo"),
    pool: normalizePool(pool),
    mode: normalizeMode(mode),
    maxGuesses: CLASSIC_MAX_GUESSES[normalizeMode(mode)],
    answerBvid: draw.answerBvid,
    guessBvids: [],
    finished: false,
    won: false,
    statsRecorded: false,
    finishReason: null,
    poolProgress: draw.shoe.seen.length,
    poolSize: songs.length,
  };
  return { state: classicView(state, songs), shoe: draw.shoe };
}

/** @param {string | null | undefined} expectedPool */
export function restoreClassicRound(raw, songs, expectedPool = null) {
  if (!raw || raw.schemaVersion !== LOCAL_CLASSIC_SCHEMA_VERSION || !Array.isArray(raw.guessBvids)) return null;
  if (typeof raw.roundId !== "string" || !raw.roundId) return null;
  if (expectedPool && normalizePool(raw.pool) !== normalizePool(expectedPool)) return null;
  const catalog = byBvid(songs);
  if (typeof raw.answerBvid !== "string" || !catalog.has(raw.answerBvid)) return null;
  const mode = normalizeMode(raw.mode);
  const maxGuesses = CLASSIC_MAX_GUESSES[mode];
  const guessBvids = [...new Set(raw.guessBvids.filter((bvid) => typeof bvid === "string" && catalog.has(bvid)))].slice(0, maxGuesses);
  const won = guessBvids.includes(raw.answerBvid);
  const surrendered = raw.finished === true && raw.finishReason === "surrender" && !won;
  const finished = surrendered || won || guessBvids.length >= maxGuesses;
  const state = {
    ...raw,
    pool: normalizePool(raw.pool),
    mode,
    maxGuesses,
    guessBvids,
    finished,
    won,
    statsRecorded: raw.statsRecorded === true,
    finishReason: finished ? (won ? "guessed" : raw.finishReason === "surrender" ? "surrender" : "attempts") : null,
    poolSize: songs.length,
  };
  return classicView(state, songs);
}

export function guessClassic(state, songs, bvid) {
  if (!state || state.finished) return state;
  const catalog = byBvid(songs);
  if (!catalog.has(bvid)) throw new Error("这不是有效的题库作品");
  if (state.guessBvids.includes(bvid)) throw new Error("这首作品已经猜过了");
  const guessBvids = [...state.guessBvids, bvid];
  const correct = bvid === state.answerBvid;
  const finished = correct || guessBvids.length >= state.maxGuesses;
  return classicView({
    ...state,
    guessBvids,
    finished,
    won: correct,
    finishReason: finished ? (correct ? "guessed" : "attempts") : null,
    statsRecorded: finished,
  }, songs);
}

export function surrenderClassic(state, songs) {
  if (!state || state.finished) return state;
  return classicView({ ...state, finished: true, won: false, finishReason: "surrender", statsRecorded: true }, songs);
}

export function clueView(state, songs) {
  const answer = answerFor(state, songs);
  if (!answer) return null;
  const unlockedCount = Math.min(CLUE_COUNT, state.actions.length + (state.finished && state.won ? 0 : 1));
  return {
    ...state,
    maxAttempts: CLUE_MAX_ATTEMPTS,
    clueCount: CLUE_COUNT,
    clues: clueDefinitions(answer).slice(0, unlockedCount),
    ...(state.finished ? { answer } : {}),
  };
}

export function createClueRound({ pool = "normal", songs, shoe = null, nextIndex = secureRandomIndex }) {
  const allBvids = songs.map((song) => song.bvid);
  const draw = drawFromShoe(readLocalShoe(shoe, allBvids) ?? createShoe(allBvids, [], nextIndex), allBvids, null, nextIndex);
  const state = {
    schemaVersion: LOCAL_CLUE_SCHEMA_VERSION,
    roundId: roundId("clue"),
    pool: normalizePool(pool),
    answerBvid: draw.answerBvid,
    actions: [],
    finished: false,
    won: false,
    finishReason: null,
    poolProgress: draw.shoe.seen.length,
    poolSize: songs.length,
  };
  return { state: clueView(state, songs), shoe: draw.shoe };
}

/** @param {string | null | undefined} expectedPool */
export function restoreClueRound(raw, songs, expectedPool = null) {
  if (!raw || raw.schemaVersion !== LOCAL_CLUE_SCHEMA_VERSION || !Array.isArray(raw.actions)) return null;
  if (typeof raw.roundId !== "string" || !raw.roundId) return null;
  if (expectedPool && normalizePool(raw.pool) !== normalizePool(expectedPool)) return null;
  if (typeof raw.answerBvid !== "string" || !byBvid(songs).has(raw.answerBvid)) return null;
  const catalog = byBvid(songs);
  const actions = raw.actions.filter((action) => (
    action && (action.type === "skip" || action.type === "guess")
    && (action.type === "skip" || (typeof action.bvid === "string" && catalog.has(action.bvid)))
  )).slice(0, CLUE_MAX_ATTEMPTS).map((action, index) => ({
    ...action,
    attempt: index + 1,
    name: action.type === "guess" ? catalog.get(action.bvid).name : undefined,
    correct: action.type === "guess" && action.bvid === raw.answerBvid,
  }));
  const won = actions.some((action) => action.correct);
  const surrendered = raw.finished === true && raw.finishReason === "surrender" && !won;
  const finished = surrendered || won || actions.length >= CLUE_MAX_ATTEMPTS;
  return clueView({
    ...raw,
    pool: normalizePool(raw.pool),
    actions,
    finished,
    won,
    finishReason: finished ? (won ? "guessed" : raw.finishReason === "surrender" ? "surrender" : "attempts") : null,
    poolSize: songs.length,
  }, songs);
}

export function actClue(state, songs, action, bvid) {
  if (!state || state.finished) return state;
  const catalog = byBvid(songs);
  if (action === "guess") {
    if (!catalog.has(bvid)) throw new Error("这不是有效的题库作品");
    if (state.actions.some((item) => item.type === "guess" && item.bvid === bvid)) throw new Error("这首作品已经猜过了");
  }
  const correct = action === "guess" && bvid === state.answerBvid;
  const nextActions = [...state.actions, {
    type: action,
    attempt: state.actions.length + 1,
    ...(action === "guess" ? { bvid, name: catalog.get(bvid).name } : {}),
    correct,
  }];
  const finished = correct || nextActions.length >= CLUE_MAX_ATTEMPTS;
  return clueView({
    ...state,
    actions: nextActions,
    finished,
    won: correct,
    finishReason: finished ? (correct ? "guessed" : "attempts") : null,
  }, songs);
}

export function surrenderClue(state, songs) {
  if (!state || state.finished) return state;
  return clueView({ ...state, finished: true, won: false, finishReason: "surrender" }, songs);
}

function compareTimelineSongs(left, right) {
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

export function timelineView(state, songs) {
  const catalog = byBvid(songs);
  const targetBvid = state.targetBvids[state.placements.length];
  const target = state.finished || !targetBvid ? null : catalog.get(targetBvid);
  if (!state.timeline.every((song) => catalog.has(song.bvid))) return null;
  return {
    ...state,
    maxPlacements: TIMELINE_PLACEMENTS,
    timeline: state.timeline.map(publicTimelineSong),
    target: target ? { bvid: target.bvid, name: target.name } : null,
  };
}

export function createTimelineRound({ pool = "normal", songs, nextIndex = secureRandomIndex }) {
  if (songs.length < TIMELINE_PLACEMENTS + 1) throw new Error("题库作品不足，暂时无法开始");
  const remaining = [...songs];
  const selected = [];
  while (selected.length < TIMELINE_PLACEMENTS + 1) selected.push(remaining.splice(nextIndex(remaining.length), 1)[0]);
  const state = {
    schemaVersion: LOCAL_TIMELINE_SCHEMA_VERSION,
    roundId: roundId("timeline"),
    pool: normalizePool(pool),
    targetBvids: selected.slice(1).map((song) => song.bvid),
    placements: [],
    score: 0,
    timeline: [selected[0]],
    finished: false,
  };
  return timelineView(state, songs);
}

/** @param {string | null | undefined} expectedPool */
export function restoreTimelineRound(raw, songs, expectedPool = null) {
  if (!raw || raw.schemaVersion !== LOCAL_TIMELINE_SCHEMA_VERSION || !Array.isArray(raw.targetBvids) || !Array.isArray(raw.timeline) || !Array.isArray(raw.placements)) return null;
  if (typeof raw.roundId !== "string" || !raw.roundId) return null;
  if (expectedPool && normalizePool(raw.pool) !== normalizePool(expectedPool)) return null;
  const catalog = byBvid(songs);
  if (raw.targetBvids.length !== TIMELINE_PLACEMENTS || new Set(raw.targetBvids).size !== raw.targetBvids.length || !raw.targetBvids.every((bvid) => typeof bvid === "string" && catalog.has(bvid))) return null;
  const timelineBvids = raw.timeline.map((song) => typeof song === "string" ? song : song?.bvid);
  const timeline = timelineBvids.map((bvid) => catalog.get(bvid)).filter(Boolean);
  if (!timeline.length || timeline.length !== timelineBvids.length || timeline.length !== raw.placements.length + 1 || new Set(timelineBvids).size !== timelineBvids.length) return null;
  if (raw.placements.length > TIMELINE_PLACEMENTS || raw.placements.some((placement, index) => (
    !placement
    || typeof placement.bvid !== "string"
    || !catalog.has(placement.bvid)
    || placement.bvid !== raw.targetBvids[index]
  ))) return null;
  const placedBvids = new Set(raw.placements.map((placement) => placement.bvid));
  const futureBvids = new Set(raw.targetBvids.slice(raw.placements.length));
  if (!raw.placements.every((placement) => timelineBvids.includes(placement.bvid))) return null;
  if (timelineBvids.some((bvid) => futureBvids.has(bvid))) return null;
  const anchors = timelineBvids.filter((bvid) => !placedBvids.has(bvid));
  if (anchors.length !== 1 || raw.targetBvids.includes(anchors[0])) return null;
  const score = raw.placements.filter((placement) => placement.correct === true).length;
  return timelineView({
    ...raw,
    pool: normalizePool(raw.pool),
    placements: raw.placements.slice(0, TIMELINE_PLACEMENTS),
    score,
    finished: raw.placements.length >= TIMELINE_PLACEMENTS,
    timeline,
  }, songs);
}

export function placeTimeline(state, songs, slotValue) {
  if (!state || state.finished) return state;
  const catalog = byBvid(songs);
  const target = catalog.get(state.targetBvids[state.placements.length]);
  const slot = Number(slotValue);
  if (!target || !Number.isInteger(slot) || slot < 0 || slot > state.timeline.length) throw new Error("请选择时间线上的一个位置");
  const sorted = [...state.timeline].sort(compareTimelineSongs);
  const earliestSlot = sorted.filter((song) => song.publicationDate < target.publicationDate).length;
  const latestSlot = sorted.filter((song) => song.publicationDate <= target.publicationDate).length;
  const correct = slot >= earliestSlot && slot <= latestSlot;
  const insertedSlot = correct ? slot : latestSlot;
  sorted.splice(insertedSlot, 0, target);
  const placement = {
    turn: state.placements.length + 1,
    bvid: target.bvid,
    name: target.name,
    chosenSlot: slot,
    correctSlotStart: earliestSlot,
    correctSlotEnd: latestSlot,
    correct,
    publicationDate: target.publicationDate,
  };
  const nextState = {
    ...state,
    placements: [...state.placements, placement],
    timeline: sorted,
    score: state.score + (correct ? 1 : 0),
    finished: state.placements.length + 1 >= TIMELINE_PLACEMENTS,
    lastPlacement: {
      correct,
      insertedSlot,
      earliestSlot,
      latestSlot,
      song: publicTimelineSong(target),
    },
  };
  return timelineView(nextState, songs);
}

export function clueLabelForSong(song) {
  return clueDefinitions(song).map((clue) => `${clue.label}: ${clue.value}`);
}

export { formatTier, countTitleCharacters };
