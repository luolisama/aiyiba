import { randomBytes, randomUUID } from "node:crypto";

import {
  comparePublicationDate,
  countTitleCharacters,
} from "../app/game-logic.mjs";
import { CLUE_COUNT, CLUE_MAX_ATTEMPTS, clueDefinitions } from "./clue-rules.mjs";

export const PK_MODE = "normal";
export const PK_MAX_GUESSES = 6;
export const PK_MIN_PLAYERS = 2;
export const PK_MAX_PLAYERS = 8;
export const PK_MAX_ROOMS = 15;
export const PK_COUNTDOWN_MS = 3_000;
export const PK_ROOM_TTL_MS = 30 * 60 * 1_000;
export const PK_GUESS_INTERVAL_MS = 500;
export const PK_START_GRACE_MS = 350;
export const PK_ABSOLUTE_ROOM_TTL_MS = 2 * 60 * 60 * 1_000;
export const PK_FORFEIT_RECEIPT_TTL_MS = 30 * 60 * 1_000;
export const PK_CLUE_STAGE_MS = 20 * 1_000;
export const PK_GAME_TYPE = "classic";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TIER_ORDER = ["普通曲", "殿堂曲", "专兑曲", "传说曲", "神话曲"];
const POOL_LABELS = {
  normal: "标准题库",
  hardcore: "扩展题库",
};

function defaultRandomIndex(maxExclusive) {
  return randomBytes(4).readUInt32BE(0) % maxExclusive;
}

function makeToken() {
  return randomBytes(18).toString("base64url");
}

function cleanName(value) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/gu, "")
    .replace(/[<>]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const segments = typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(normalized)].map((item) => item.segment)
    : [...normalized];
  return segments.slice(0, 18).join("");
}

const RESERVED_NAMES = new Set(["系统", "管理员", "官方", "客服"]);

function assertName(value) {
  const name = cleanName(value);
  if (!name) throw new Error("请先输入昵称");
  if (RESERVED_NAMES.has(name.toLocaleLowerCase("zh-CN"))) throw new Error("这个昵称不能使用，请换一个");
  return name;
}

function nameKey(value) {
  return cleanName(value).toLocaleLowerCase("zh-CN");
}

function compareSet(guess, answer) {
  const left = [...guess].sort();
  const right = [...answer].sort();
  if (left.length === right.length && left.every((value, index) => value === right[index])) return "correct";
  if (guess.some((value) => answer.includes(value))) return "partial";
  return "wrong";
}

function formatTier(value) {
  return String(value ?? "").replace(/曲$/u, "");
}

function normalizePool(value) {
  // `extended` is accepted as a harmless future-facing alias, while the
  // persisted protocol key remains `hardcore` for compatibility with the
  // existing hidden single-player route. It is never exposed as UI copy.
  return value === "extended" || value === "hardcore" ? "hardcore" : "normal";
}

function normalizeGameType(value) {
  return value === "clues" ? "clues" : PK_GAME_TYPE;
}

function normalizeCatalogs(value) {
  // Keep the original single-catalog manager API working for existing tests
  // and integrations. Those callers get the standard catalog for both pools.
  if (value?.items) return { normal: value, hardcore: value };
  const normal = value?.normal?.items?.length ? value.normal : value?.standard;
  const hardcore = value?.hardcore?.items?.length
    ? value.hardcore
    : value?.extended?.items?.length
      ? value.extended
      : normal;
  return { normal, hardcore: hardcore ?? normal };
}

function compareSong(guess, answer) {
  const guessLength = countTitleCharacters(guess.name);
  const answerLength = countTitleCharacters(answer.name);
  const dateClue = comparePublicationDate(guess.publicationDate, answer.publicationDate);
  const guessTier = TIER_ORDER.indexOf(guess.viewTier);
  const answerTier = TIER_ORDER.indexOf(answer.viewTier);

  return [
    { tone: guess.bvid === answer.bvid ? "correct" : "wrong", text: guess.name },
    { tone: compareSet(guess.vocalists, answer.vocalists), text: guess.vocalists.join("、") },
    { tone: compareSet(guess.engines, answer.engines), text: guess.engines.join("、") },
    {
      tone: guessLength === answerLength ? "correct" : "wrong",
      text: `${guessLength}字`,
      hint: guessLength === answerLength ? undefined : guessLength < answerLength ? "↑ 更长" : "↓ 更短",
    },
    { tone: dateClue.tone, text: dateClue.text, hint: dateClue.hint },
    {
      tone: guess.viewTier === answer.viewTier ? "correct" : "wrong",
      text: formatTier(guess.viewTier),
      hint: guessTier === answerTier ? undefined : guessTier < answerTier ? "↑ 更高" : "↓ 更低",
    },
  ];
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

function event(target, type, data = {}) {
  return { target, type, data };
}

function roomPlayers(room) {
  return [...room.players.values()].map((player) => ({
    id: player.id,
    name: player.name,
    ready: player.ready,
    nextReady: player.nextReady,
    connected: player.connected,
    attempts: room.gameType === "clues" ? player.clueActions.length : player.attempts.length,
    clueSubmitted: room.gameType === "clues" && room.clueStage > 0
      ? player.clueActions.some((action) => action.stage === room.clueStage)
      : false,
    clueStage: room.gameType === "clues" ? room.clueStage : null,
    finished: player.finished,
    left: player.left,
    forfeited: player.forfeited,
    isHost: player.id === room.hostPlayerId,
  }));
}

export function createPkManager(catalog, options = {}) {
  const now = options.now ?? (() => Date.now());
  const randomIndex = options.randomIndex ?? defaultRandomIndex;
  const countdownMs = options.countdownMs ?? PK_COUNTDOWN_MS;
  const roomTtlMs = options.roomTtlMs ?? PK_ROOM_TTL_MS;
  const lobbyRoomTtlMs = options.lobbyRoomTtlMs ?? roomTtlMs;
  const absoluteRoomTtlMs = options.absoluteRoomTtlMs ?? PK_ABSOLUTE_ROOM_TTL_MS;
  const guessIntervalMs = options.guessIntervalMs ?? 0;
  const startGraceMs = options.startGraceMs ?? 0;
  const maxRooms = options.maxRooms ?? PK_MAX_ROOMS;
  const forfeitReceiptTtlMs = options.forfeitReceiptTtlMs ?? PK_FORFEIT_RECEIPT_TTL_MS;
  const catalogs = normalizeCatalogs(catalog);
  const catalogByPool = new Map(Object.entries(catalogs).map(([pool, item]) => {
    const songs = [...(item?.items ?? [])];
    return [pool, { catalog: item, songs, byBvid: new Map(songs.map((song) => [song.bvid, song])) }];
  }));
  const rooms = new Map();
  const forfeitReceipts = new Map();

  function forfeitReceiptKey(code, token) {
    return `${String(code ?? "").trim().toUpperCase()}:${String(token ?? "")}`;
  }

  function rememberForfeit(room, player) {
    if (!room.roundId) return;
    forfeitReceipts.set(forfeitReceiptKey(room.code, player.token), {
      roundId: room.roundId,
      pool: normalizePool(room.pool),
      mode: room.mode,
      gameType: room.gameType,
      attempts: room.gameType === "clues" ? player.clueActions.length : player.attempts.length,
      deviceId: player.deviceId,
      expiresAt: now() + forfeitReceiptTtlMs,
    });
  }

  function forfeitSummary(code, token, deviceId = null) {
    const receipt = forfeitReceipts.get(forfeitReceiptKey(code, token));
    if (!receipt) return null;
    if (receipt.expiresAt <= now()) {
      forfeitReceipts.delete(forfeitReceiptKey(code, token));
      return null;
    }
    if (receipt.deviceId && deviceId && receipt.deviceId !== deviceId) throw new Error("该房间属于另一个浏览器");
    return {
      roundId: receipt.roundId,
      pool: receipt.pool,
      mode: receipt.mode,
      attempts: receipt.attempts,
    };
  }

  function catalogFor(poolValue) {
    const pool = normalizePool(poolValue);
    const current = catalogByPool.get(pool) ?? catalogByPool.get("normal");
    if (!current?.songs.length) throw new Error("题库为空，无法开始多人游戏");
    return { pool, ...current };
  }

  function makeCode() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      let code = "";
      for (let index = 0; index < 6; index += 1) code += CODE_ALPHABET[randomIndex(CODE_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
    throw new Error("暂时无法生成房间码，请稍后再试");
  }

  function getRoom(code) {
    const room = rooms.get(String(code ?? "").trim().toUpperCase());
    if (!room) throw new Error("房间不存在或已经过期");
    return room;
  }

  function getPlayer(room, playerId) {
    const player = room.players.get(playerId);
    if (!player) throw new Error("玩家不在这个房间里");
    return player;
  }

  function activePlayers(room) {
    return [...room.players.values()].filter((player) => !player.left && !player.forfeited);
  }

  function connectedActivePlayers(room) {
    return activePlayers(room).filter((player) => player.connected);
  }

  function resetRoundFields(room, preserveNextReady = false, preparedBy = null) {
    room.status = "lobby";
    room.answerBvid = null;
    room.roundId = null;
    room.startAt = null;
    room.countdownEndsAt = null;
    room.clueStage = 0;
    room.stageEndsAt = null;
    room.winnerPlayerId = null;
    room.winnerPlayerIds = [];
    room.result = null;
    for (const player of room.players.values()) {
      player.ready = preserveNextReady && (player.nextReady || player.id === preparedBy);
      player.nextReady = false;
      player.attempts = [];
      player.clueActions = [];
      player.lastGuessAt = 0;
      player.finished = false;
      player.left = false;
      player.forfeited = false;
    }
  }

  function makePlayer(name, deviceId = null) {
    return {
      id: randomUUID(),
      token: makeToken(),
      name: cleanName(name),
      ready: false,
      nextReady: false,
      connected: true,
      attempts: [],
      clueActions: [],
      lastGuessAt: 0,
      finished: false,
      left: false,
      forfeited: false,
      deviceId,
    };
  }

  function closeRoom(room, reason = "closed") {
    const playerIds = [...room.players.keys()];
    for (const player of room.players.values()) {
      player.connected = false;
      player.deviceId = null;
    }
    rooms.delete(room.code);
    return { room: null, closed: { code: room.code, reason, playerIds, roundId: room.roundId }, events: [] };
  }

  function stateEvents(room) {
    return [event(null, "room:state", publicState(room))];
  }

  function publicState(room) {
    const pool = normalizePool(room.pool);
    const { byBvid } = catalogFor(pool);
    const endedAnswer = room.status === "ended" && room.answerBvid ? publicSong(byBvid.get(room.answerBvid)) : undefined;
    const clueValues = room.gameType === "clues" && room.answerBvid
      ? clueDefinitions(byBvid.get(room.answerBvid)).slice(0, Math.min(room.clueStage, CLUE_COUNT))
      : [];
    return {
      code: room.code,
      status: room.status,
      mode: room.mode,
      gameType: room.gameType,
      pool,
      poolLabel: POOL_LABELS[pool],
      visibility: room.visibility,
      maxPlayers: room.maxPlayers,
      maxGuesses: room.maxGuesses,
      roundId: room.roundId,
      startAt: room.startAt,
      countdownEndsAt: room.countdownEndsAt,
      clueStage: room.gameType === "clues" ? room.clueStage : null,
      stageEndsAt: room.gameType === "clues" ? room.stageEndsAt : null,
      clues: clueValues,
      winnerPlayerId: room.winnerPlayerId,
      winnerPlayerIds: room.winnerPlayerIds ?? (room.winnerPlayerId ? [room.winnerPlayerId] : []),
      players: roomPlayers(room),
      result: room.result,
      ...(endedAnswer ? { answer: endedAnswer } : {}),
    };
  }

  function chooseAnswer(room) {
    const { songs } = catalogFor(room.pool);
    let available = songs.filter((song) => !room.usedBvids.includes(song.bvid));
    if (!available.length) {
      room.usedBvids = [];
      available = songs;
    }
    if (available.length > 1 && available.some((song) => song.bvid === room.answerBvid)) {
      available = available.filter((song) => song.bvid !== room.answerBvid);
    }
    const answer = available[randomIndex(available.length)];
    if (!answer) throw new Error("题库为空，无法开始多人游戏");
    room.answerBvid = answer.bvid;
    room.usedBvids.push(answer.bvid);
    return answer;
  }

  function beginCountdown(room) {
    chooseAnswer(room);
    room.status = "countdown";
    room.roundId = randomUUID();
    room.countdownEndsAt = now() + countdownMs;
    room.startAt = room.countdownEndsAt;
    room.winnerPlayerId = null;
    room.winnerPlayerIds = [];
    room.result = null;
    room.clueStage = 0;
    room.stageEndsAt = null;
    for (const player of activePlayers(room)) {
      player.attempts = [];
      player.clueActions = [];
      player.lastGuessAt = 0;
      player.finished = false;
      player.nextReady = false;
    }
    return [
      ...stateEvents(room),
      event(null, "round:countdown", {
        roundId: room.roundId,
        startAt: room.startAt,
        maxGuesses: room.maxGuesses,
        gameType: room.gameType,
      }),
    ];
  }

  function createRoom(name, mode = PK_MODE, visibility = "private", deviceId = null, poolValue = "normal", gameTypeValue = PK_GAME_TYPE) {
    if (rooms.size >= maxRooms) throw new Error("当前多人房间已满，请加入已有房间或稍后再试");
    const playerName = assertName(name);
    const pool = normalizePool(poolValue);
    const gameType = normalizeGameType(gameTypeValue);
    catalogFor(pool);
    const normalizedMode = gameType === "clues" ? PK_MODE : mode === "hard" ? "hard" : PK_MODE;
    const code = makeCode();
    const player = makePlayer(playerName, deviceId);
    const room = {
      code,
      mode: normalizedMode,
      gameType,
      pool,
      visibility: visibility === "public" ? "public" : "private",
      hostPlayerId: player.id,
      maxPlayers: PK_MAX_PLAYERS,
      maxGuesses: gameType === "clues" ? CLUE_MAX_ATTEMPTS : normalizedMode === "hard" ? 4 : PK_MAX_GUESSES,
      status: "lobby",
      players: new Map([[player.id, player]]),
      usedBvids: [],
      answerBvid: null,
      roundId: null,
      startAt: null,
      countdownEndsAt: null,
      clueStage: 0,
      stageEndsAt: null,
      winnerPlayerId: null,
      winnerPlayerIds: [],
      result: null,
      createdAt: now(),
      lastActivity: now(),
    };
    rooms.set(code, room);
    return {
      room,
      player,
      events: [event(player.id, "room:created", { code, playerId: player.id, playerToken: player.token, room: publicState(room) })],
    };
  }

  function joinRoom(code, name, deviceId = null) {
    const room = getRoom(code);
    if (room.players.size >= room.maxPlayers) throw new Error("这个多人房间已经满员了");
    if (room.status !== "lobby") throw new Error("这局已经开始，暂时不能加入");
    if (!connectedActivePlayers(room).some((player) => player.id === room.hostPlayerId)) throw new Error("房主正在重连，请稍后再试");
    const playerName = assertName(name);
    if ([...room.players.values()].some((player) => nameKey(player.name) === nameKey(playerName))) {
      throw new Error("这个昵称已经在房间里了，请换一个");
    }
    const player = makePlayer(playerName, deviceId);
    room.players.set(player.id, player);
    room.lastActivity = now();
    return {
      room,
      player,
      events: [
        event(player.id, "room:joined", { code: room.code, playerId: player.id, playerToken: player.token, room: publicState(room) }),
        ...stateEvents(room),
      ],
    };
  }

  function reconnectRoom(code, token, deviceId = null) {
    const room = getRoom(code);
    const player = [...room.players.values()].find((item) => item.token === token);
    if (!player) throw new Error("重连凭据无效");
    if (player.left || player.forfeited) throw new Error("这名玩家已经退出本轮，无法重连");
    if (player.deviceId && deviceId && player.deviceId !== deviceId) throw new Error("该房间属于另一个浏览器");
    if (!player.deviceId && deviceId) player.deviceId = deviceId;
    player.connected = true;
    room.lastActivity = now();
    const { byBvid } = catalogFor(room.pool);
    const answer = room.answerBvid ? byBvid.get(room.answerBvid) : null;
    const rows = answer && room.gameType !== "clues"
      ? player.attempts.map((bvid, index) => {
          const guess = byBvid.get(bvid);
          return {
            bvid,
            attempt: index + 1,
            cells: compareSong(guess, answer),
          };
        })
      : [];
    const actions = room.gameType === "clues"
      ? player.clueActions.map((action) => ({
          stage: action.stage,
          type: action.type,
          bvid: action.bvid ?? null,
          name: action.name ?? null,
        }))
      : [];
    return { room, player, events: [...stateEvents(room), event(player.id, "round:history", { rows, actions })] };
  }

  function setReady(code, playerId, ready = true) {
    const room = getRoom(code);
    const player = getPlayer(room, playerId);
    if (room.status !== "lobby") throw new Error("当前不是准备阶段");
    if (player.left || player.forfeited || !player.connected) throw new Error("当前玩家不能准备");
    player.ready = Boolean(ready);
    room.lastActivity = now();
    return { room, events: stateEvents(room) };
  }

  function updateSettings(code, playerId, modeValue = "normal", poolValue = "normal", gameTypeValue = PK_GAME_TYPE) {
    const room = getRoom(code);
    getPlayer(room, playerId);
    if (room.status !== "lobby") throw new Error("当前不是准备阶段，房间设置已经锁定");
    if (room.hostPlayerId !== playerId) throw new Error("只有房主可以修改房间设置");

    const gameType = normalizeGameType(gameTypeValue);
    const mode = gameType === "clues" ? "normal" : modeValue === "hard" ? "hard" : "normal";
    const pool = normalizePool(poolValue);
    catalogFor(pool);
    const changed = room.gameType !== gameType || room.mode !== mode || normalizePool(room.pool) !== pool;
    room.gameType = gameType;
    room.mode = mode;
    room.pool = pool;
    room.maxGuesses = gameType === "clues" ? CLUE_MAX_ATTEMPTS : mode === "hard" ? 4 : PK_MAX_GUESSES;
    if (changed) {
      for (const player of room.players.values()) {
        player.ready = false;
        player.nextReady = false;
      }
    }
    room.lastActivity = now();
    return { room, events: stateEvents(room) };
  }

  function setNextReady(code, playerId, ready = true) {
    const room = getRoom(code);
    const player = getPlayer(room, playerId);
    if (room.status !== "ended") throw new Error("当前还没有结算");
    if (player.left || player.forfeited || !player.connected) throw new Error("退出本轮的玩家不能准备下一局");
    player.nextReady = Boolean(ready);
    room.lastActivity = now();
    return { room, events: stateEvents(room) };
  }

  function startRoom(code, playerId) {
    const room = getRoom(code);
    if (room.status !== "lobby") throw new Error("当前不是准备阶段");
    if (room.hostPlayerId !== playerId) throw new Error("只有房主可以开始多人游戏");
    const players = activePlayers(room);
    if (players.length < PK_MIN_PLAYERS) throw new Error("至少需要两名玩家才能开始");
    if (!players.every((item) => item.ready && item.connected)) throw new Error("请等待所有玩家准备");
    room.lastActivity = now();
    return { room, events: beginCountdown(room) };
  }

  function startPlaying(code) {
    const room = getRoom(code);
    if (room.status !== "countdown") return { room, events: [] };
    room.status = "playing";
    if (room.gameType === "clues") {
      room.clueStage = 1;
      room.stageEndsAt = now() + PK_CLUE_STAGE_MS;
    }
    room.lastActivity = now();
    return {
      room,
      events: [
        ...stateEvents(room),
        event(null, "round:started", {
          roundId: room.roundId,
          startAt: room.startAt,
          maxGuesses: room.maxGuesses,
          gameType: room.gameType,
          clueStage: room.gameType === "clues" ? room.clueStage : null,
          stageEndsAt: room.gameType === "clues" ? room.stageEndsAt : null,
        }),
      ],
    };
  }

  function roundEndedEvents(room, reason) {
    const { byBvid } = catalogFor(room.pool);
    const answer = byBvid.get(room.answerBvid);
    const players = roomPlayers(room).map((player) => {
      const source = room.players.get(player.id);
      const clueActions = room.gameType === "clues"
        ? source.clueActions.map((action) => ({
            stage: action.stage,
            type: action.type,
            bvid: action.bvid ?? null,
            name: action.name ?? null,
            correct: Boolean(action.correct),
          }))
        : [];
      return {
        ...player,
        guesses: source.attempts.map((bvid) => ({
          bvid,
          name: byBvid.get(bvid)?.name ?? bvid,
          correct: bvid === room.answerBvid,
        })),
        clueActions,
      };
    });
    const winnerPlayerIds = room.winnerPlayerIds ?? (room.winnerPlayerId ? [room.winnerPlayerId] : []);
    room.result = { reason, winnerPlayerId: room.winnerPlayerId, winnerPlayerIds, players };
    return [
      ...stateEvents(room),
      event(null, "round:ended", {
        reason,
        winnerPlayerId: room.winnerPlayerId,
        winnerPlayerIds,
        gameType: room.gameType,
        clues: room.gameType === "clues" && room.answerBvid
          ? clueDefinitions(answer).slice(0, Math.min(room.clueStage, CLUE_COUNT))
          : [],
        answer: publicSong(answer),
        players,
      }),
    ];
  }

  function finishAfterDeparture(room) {
    const active = activePlayers(room);
    if (!active.length) {
      room.status = "ended";
      room.winnerPlayerId = null;
      room.winnerPlayerIds = [];
      return "draw";
    }
    if (active.length === 1) {
      room.status = "ended";
      room.winnerPlayerId = active[0].id;
      room.winnerPlayerIds = [active[0].id];
      return "forfeit";
    }
    if (active.every((player) => player.finished)) {
      room.status = "ended";
      room.winnerPlayerId = null;
      room.winnerPlayerIds = [];
      return "draw";
    }
    return null;
  }

  function activePlayersActed(room) {
    return activePlayers(room).every((player) => player.clueActions.some((action) => action.stage === room.clueStage));
  }

  function resolveClueStage(room, force = false) {
    if (room.gameType !== "clues" || room.status !== "playing" || room.clueStage < 1) return [];
    const active = activePlayers(room);
    if (!active.length) {
      room.status = "ended";
      room.winnerPlayerId = null;
      room.winnerPlayerIds = [];
      room.stageEndsAt = null;
      return roundEndedEvents(room, "draw");
    }
    if (!force && !activePlayersActed(room)) return stateEvents(room);
    const correctPlayers = active.filter((player) => player.clueActions.some((action) => (
      action.stage === room.clueStage && action.type === "guess" && action.correct
    )));
    if (correctPlayers.length) {
      room.status = "ended";
      room.winnerPlayerIds = correctPlayers.map((player) => player.id);
      room.winnerPlayerId = correctPlayers.length === 1 ? correctPlayers[0].id : null;
      room.stageEndsAt = null;
      return roundEndedEvents(room, "correct");
    }
    if (room.clueStage >= CLUE_MAX_ATTEMPTS) {
      room.status = "ended";
      room.winnerPlayerIds = [];
      room.winnerPlayerId = null;
      room.stageEndsAt = null;
      return roundEndedEvents(room, "draw");
    }
    room.clueStage += 1;
    room.stageEndsAt = now() + PK_CLUE_STAGE_MS;
    room.lastActivity = now();
    return [
      ...stateEvents(room),
      event(null, "clue:stage", {
        stage: room.clueStage,
        stageEndsAt: room.stageEndsAt,
        clues: clueDefinitions(catalogFor(room.pool).byBvid.get(room.answerBvid)).slice(0, Math.min(room.clueStage, CLUE_COUNT)),
      }),
    ];
  }

  function resolveClueStageIfReady(code, force = false) {
    const room = getRoom(code);
    const events = resolveClueStage(room, force);
    return { room, events };
  }

  function submitClueAction(code, playerId, type, bvid = null) {
    const room = getRoom(code);
    const player = getPlayer(room, playerId);
    if (room.gameType !== "clues") throw new Error("当前房间不是线索阶梯玩法");
    if (room.status !== "playing") throw new Error("当前还不能提交答案");
    if (!player.connected) throw new Error("连接已断开，请重新连接");
    if (player.left || player.forfeited) throw new Error("你已经退出本轮");
    const currentTime = now();
    if (room.stageEndsAt && currentTime >= room.stageEndsAt) throw new Error("本阶段已经结束，请等待下一条线索");
    if (player.clueActions.some((action) => action.stage === room.clueStage)) throw new Error("这一层已经操作过了");
    if (startGraceMs > 0 && room.startAt && currentTime - room.startAt < startGraceMs) throw new Error("请等倒计时结束后再猜");
    if (guessIntervalMs > 0 && currentTime - player.lastGuessAt < guessIntervalMs) throw new Error("猜得太快了，请稍等一下");
    const { byBvid } = catalogFor(room.pool);
    let guess = null;
    if (type === "guess") {
      if (!byBvid.has(bvid)) throw new Error("这不是有效的题库作品");
      if (player.clueActions.some((action) => action.type === "guess" && action.bvid === bvid)) throw new Error("这首作品已经猜过了");
      guess = byBvid.get(bvid);
    } else if (type !== "skip") {
      throw new Error("不支持的阶梯操作");
    }
    player.lastGuessAt = currentTime;
    const action = {
      stage: room.clueStage,
      type,
      bvid: type === "guess" ? bvid : null,
      name: guess?.name ?? null,
      correct: type === "guess" && bvid === room.answerBvid,
      submittedAt: currentTime,
    };
    player.clueActions.push(action);
    room.lastActivity = currentTime;
    const events = [event(player.id, "clue:submitted", {
      stage: room.clueStage,
      attempt: player.clueActions.length,
      actionType: type,
      bvid: action.bvid,
      name: action.name,
    }), event(null, "player:progress", {
      playerId,
      attempts: player.clueActions.length,
      finished: false,
      clueStage: room.clueStage,
      clueSubmitted: true,
    })];
    events.push(...resolveClueStage(room));
    return { room, events };
  }

  function submitGuess(code, playerId, bvid) {
    const room = getRoom(code);
    if (room.gameType === "clues") return submitClueAction(code, playerId, "guess", bvid);
    const player = getPlayer(room, playerId);
    if (room.status !== "playing") throw new Error("当前还不能提交答案");
    if (!player.connected) throw new Error("连接已断开，请重新连接");
    if (player.left || player.forfeited) throw new Error("你已经退出本轮");
    if (player.finished || player.attempts.length >= room.maxGuesses) throw new Error("你的猜测次数已用完");
    const currentTime = now();
    if (startGraceMs > 0 && room.startAt && currentTime - room.startAt < startGraceMs) throw new Error("请等倒计时结束后再猜");
    if (guessIntervalMs > 0 && currentTime - player.lastGuessAt < guessIntervalMs) throw new Error("猜得太快了，请稍等一下");
    const { byBvid } = catalogFor(room.pool);
    if (!byBvid.has(bvid)) throw new Error("这不是有效的题库作品");
    if (player.attempts.includes(bvid)) throw new Error("这首作品已经猜过了");

    const guess = byBvid.get(bvid);
    const answer = byBvid.get(room.answerBvid);
    player.lastGuessAt = currentTime;
    player.attempts.push(bvid);
    room.lastActivity = now();
    const correct = bvid === room.answerBvid;
    player.finished = correct || player.attempts.length >= room.maxGuesses;
    const events = [event(player.id, "guess:result", {
      bvid,
      attempt: player.attempts.length,
      correct,
      cells: compareSong(guess, answer),
    })];
    events.push(event(null, "player:progress", { playerId, attempts: player.attempts.length, finished: player.finished }));

    if (correct) {
      room.status = "ended";
      room.winnerPlayerId = player.id;
      room.winnerPlayerIds = [player.id];
      events.push(...roundEndedEvents(room, "correct"));
    } else if (activePlayers(room).every((item) => item.finished)) {
      room.status = "ended";
      room.winnerPlayerId = null;
      room.winnerPlayerIds = [];
      events.push(...roundEndedEvents(room, "draw"));
    } else {
      events.push(...stateEvents(room));
    }
    return { room, events };
  }

  function returnToLobby(code, playerId) {
    const room = getRoom(code);
    if (room.status !== "ended") throw new Error("当前还没有结算，不能返回大厅");
    const player = getPlayer(room, playerId);
    if (room.hostPlayerId !== playerId) throw new Error("只有房主可以返回多人大厅");
    if (player.left || player.forfeited || !player.connected) throw new Error("退出本轮的玩家不能操作大厅");
    for (const [id, candidate] of room.players) {
      if (candidate.left || candidate.forfeited || !candidate.connected) room.players.delete(id);
    }
    if (!room.players.size) {
      rooms.delete(room.code);
      return { room: null, closed: { code: room.code, reason: "empty", playerIds: [] }, events: [] };
    }
    resetRoundFields(room, true, playerId);
    room.lastActivity = now();
    return { room, events: stateEvents(room) };
  }

  function kick(code, hostPlayerId, targetPlayerId) {
    const room = getRoom(code);
    if (room.status !== "lobby") throw new Error("只能在准备大厅移出玩家");
    if (room.hostPlayerId !== hostPlayerId) throw new Error("只有房主可以移出玩家");
    if (hostPlayerId === targetPlayerId) throw new Error("房主不能移出自己");
    const target = getPlayer(room, targetPlayerId);
    room.players.delete(target.id);
    target.connected = false;
    target.deviceId = null;
    room.lastActivity = now();
    return { room, kickedPlayerId: target.id, events: stateEvents(room) };
  }

  function disconnect(playerId) {
    for (const room of rooms.values()) {
      const player = room.players.get(playerId);
      if (!player) continue;
      player.connected = false;
      room.lastActivity = now();
      return { room, events: stateEvents(room) };
    }
    return { room: null, events: [] };
  }

  function expireDisconnected(code, playerId) {
    const room = getRoom(code);
    const player = room.players.get(playerId);
    if (!player || player.connected) return { room, events: [] };
    if (room.hostPlayerId === playerId) return closeRoom(room, "host-disconnected");
    if (room.status === "lobby") {
      room.players.delete(playerId);
      room.lastActivity = now();
      if (!room.players.size) return closeRoom(room, "empty");
      return { room, events: stateEvents(room) };
    }
    if (room.status === "ended") {
      room.players.delete(playerId);
      room.lastActivity = now();
      if (!room.players.size) return closeRoom(room, "empty");
      return { room, events: stateEvents(room) };
    }
    if (room.status === "countdown") {
      room.players.delete(playerId);
      resetRoundFields(room);
      room.lastActivity = now();
      return { room, events: stateEvents(room) };
    }
    if (room.status === "playing") {
      rememberForfeit(room, player);
      player.left = true;
      player.forfeited = true;
      player.finished = true;
      player.ready = false;
      player.deviceId = null;
      room.lastActivity = now();
      const reason = finishAfterDeparture(room);
      if (reason) return { room, events: roundEndedEvents(room, reason) };
      if (room.gameType === "clues" && activePlayersActed(room)) return { room, events: resolveClueStage(room, true) };
      return { room, events: stateEvents(room) };
    }
    return { room, events: [] };
  }

  function leave(code, playerId) {
    const room = getRoom(code);
    const player = getPlayer(room, playerId);
    if (room.hostPlayerId === playerId) return closeRoom(room, "host-left");
    if (room.status === "ended") {
      room.players.delete(playerId);
      room.lastActivity = now();
      if (!room.players.size) return closeRoom(room, "empty");
      return { room, events: stateEvents(room) };
    }
    if (room.status === "countdown") {
      room.players.delete(playerId);
      resetRoundFields(room);
      room.lastActivity = now();
      return { room, events: stateEvents(room) };
    }
    if (room.status === "playing") {
      player.left = true;
      player.forfeited = true;
      player.finished = true;
      player.ready = false;
      player.connected = false;
      player.deviceId = null;
      room.lastActivity = now();
      const reason = finishAfterDeparture(room);
      if (reason) return { room, events: roundEndedEvents(room, reason) };
      if (room.gameType === "clues" && activePlayersActed(room)) return { room, events: resolveClueStage(room, true) };
      return { room, events: stateEvents(room) };
    }
    room.players.delete(playerId);
    room.lastActivity = now();
    if (!room.players.size) return closeRoom(room, "empty");
    return { room, events: stateEvents(room) };
  }

  function cleanup(current = now()) {
    const expired = [];
    for (const [key, receipt] of forfeitReceipts) {
      if (receipt.expiresAt <= current) forfeitReceipts.delete(key);
    }
    for (const [code, room] of rooms) {
      const ttl = room.status === "lobby" ? Math.min(roomTtlMs, lobbyRoomTtlMs) : roomTtlMs;
      if (current - room.lastActivity > ttl || current - room.createdAt > absoluteRoomTtlMs) {
        rooms.delete(code);
        expired.push({ code, playerIds: [...room.players.keys()], roundId: room.roundId });
      }
    }
    return expired;
  }

  function publicLobbyRooms() {
    return [...rooms.values()]
      .filter((room) => room.visibility === "public" && room.status !== "ended")
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((room) => {
        const players = roomPlayers(room).filter((player) => !player.left && !player.forfeited);
        return {
          code: room.code,
          status: room.status,
          gameType: room.gameType,
          mode: room.mode,
          pool: normalizePool(room.pool),
          poolLabel: POOL_LABELS[normalizePool(room.pool)],
          maxPlayers: room.maxPlayers,
          maxGuesses: room.maxGuesses,
          playerCount: players.length,
          players: players.map((player) => ({ name: player.name, connected: player.connected })),
          hostName: players.find((player) => player.id === room.hostPlayerId)?.name ?? players[0]?.name ?? "匿名玩家",
          joinable: room.status === "lobby" && players.length < room.maxPlayers && players.some((player) => player.id === room.hostPlayerId && player.connected),
          createdAt: room.createdAt,
        };
      });
  }

  function playerByDevice(deviceId) {
    if (!deviceId) return null;
    for (const room of rooms.values()) {
      for (const player of room.players.values()) {
        if (player.deviceId === deviceId) return { room, player };
      }
    }
    return null;
  }

  return {
    createRoom,
    joinRoom,
    reconnectRoom,
    forfeitSummary,
    setReady,
    updateSettings,
    setNextReady,
    startRoom,
    startPlaying,
    submitGuess,
    submitClueAction,
    resolveClueStageIfReady,
    returnToLobby,
    kick,
    disconnect,
    expireDisconnected,
    leave,
    cleanup,
    getRoom,
    publicState,
    publicLobbyRooms,
    playerByDevice,
    roomCount: () => rooms.size,
    maxRooms,
  };
}
