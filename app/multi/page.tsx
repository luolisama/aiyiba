"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import Link from "next/link";
import searchSongsJson from "../data/search-songs.json";
import songPinyinJson from "../data/song-pinyin.json";
import hardcoreSearchSongsJson from "../data/hardcore-search-songs.json";
import hardcoreSongPinyinJson from "../data/hardcore-song-pinyin.json";
import ShareImageDialog from "../share-image-dialog";
import type { ShareCardModel } from "../share-card";
import { isExtendedOnlySong } from "../catalog-logic.mjs";
import { buildPkShareCardModel } from "../share-card-model.mjs";
import {
  countTitleCharacters,
  matchesSongQuery,
  normalizeSearchText,
} from "../game-logic.mjs";
import { normalizePkStats, recordPkRound } from "../pk/client-logic.mjs";
import { ROUND_INVALIDATED_MESSAGE } from "../round-errors.mjs";

type Tone = "correct" | "partial" | "wrong";
type GameMode = "normal" | "hard";
type GameType = "classic" | "clues";
type CatalogPool = "normal" | "hardcore";
type Cell = { tone: Tone; text: string; hint?: string };
type Song = {
  bvid: string;
  name: string;
  bilibiliTitle: string;
  searchAliases?: string[];
  searchPinyin?: string[];
  publicationDate: string;
  vocalists: string[];
  engines: string[];
  workType: string;
  gameRole: string;
  views: number | null;
  viewTier: string;
  coverUrl: string;
  bilibiliUrl: string;
};
type SearchSong = Pick<Song, "bvid" | "name" | "publicationDate" | "vocalists"> & {
  searchAliases?: string[];
  searchPinyin?: string[];
};
type Catalog = { items: SearchSong[]; viewsSnapshotDate?: string };
type Player = {
  id: string;
  name: string;
  ready: boolean;
  nextReady: boolean;
  connected: boolean;
  attempts: number;
  finished: boolean;
  left?: boolean;
  forfeited?: boolean;
  isHost?: boolean;
  clueSubmitted?: boolean;
  clueStage?: number | null;
  guesses?: Array<{ bvid: string; name: string; correct: boolean }>;
  clueActions?: Array<{ stage: number; type: "guess" | "skip"; bvid?: string | null; name?: string | null; correct?: boolean }>;
};
type RoundResult = {
  reason: "correct" | "draw" | "disconnect" | "forfeit";
  winnerPlayerId: string | null;
  winnerPlayerIds?: string[];
  gameType?: GameType;
  clues?: Array<{ key: string; label: string; value: string }>;
  players: Player[];
};
type Room = {
  code: string;
  status: "lobby" | "countdown" | "playing" | "ended";
  mode: GameMode;
  gameType?: GameType;
  pool?: CatalogPool;
  poolLabel?: string;
  visibility?: "public" | "private";
  maxPlayers: number;
  maxGuesses: number;
  roundId: string | null;
  startAt: number | null;
  countdownEndsAt: number | null;
  winnerPlayerId: string | null;
  winnerPlayerIds?: string[];
  clueStage?: number | null;
  stageEndsAt?: number | null;
  clues?: Array<{ key: string; label: string; value: string }>;
  players: Player[];
  result?: RoundResult | null;
  answer?: Answer;
};
type GuessRow = { bvid: string; attempt: number; cells: Cell[]; correct?: boolean };
type Answer = Song;
type Session = { code: string; playerToken: string; playerId: string };
type LobbyRoom = {
  code: string;
  status: "lobby" | "countdown" | "playing";
  mode: GameMode;
  gameType?: GameType;
  pool?: CatalogPool;
  poolLabel?: string;
  maxGuesses: number;
  maxPlayers: number;
  playerCount: number;
  players: Array<{ name: string; connected: boolean }>;
  hostName: string;
  joinable: boolean;
  createdAt: number;
};
type PkModeStats = {
  played: number;
  wins: number;
  losses: number;
  draws: number;
  streak: number;
  bestStreak: number;
  totalGuesses: number;
  distribution: number[];
};
type PkStats = {
  schemaVersion: number;
  pools: Record<CatalogPool, { modes: Record<GameMode, PkModeStats>; clues: PkModeStats }>;
  games?: { classic: { pools: Record<CatalogPool, { modes: Record<GameMode, PkModeStats> }> }; clues: { pools: Record<CatalogPool, { modes: { clues: PkModeStats } }> } };
  recordedRoundIds: string[];
};
type ServerMessage =
  | { type: "room:created" | "room:joined"; code: string; playerToken: string; playerId: string; room: Room }
  | { type: "lobby:snapshot"; rooms: LobbyRoom[]; roomCount: number; maxRooms: number }
  | { type: "room:reconnected"; code: string; playerId: string; room: Room }
  | { type: "room:active-elsewhere"; message: string }
  | { type: "room:reconnect-failed"; message: string }
  | { type: "room:forfeit-summary"; roundId: string; pool: CatalogPool; mode: GameMode; gameType?: GameType; attempts: number; message: string }
  | { type: "service:maintenance" | "service:resumed"; message: string }
  | (Room & { type: "room:state" })
  | { type: "round:history"; rows: GuessRow[]; actions?: Player["clueActions"] }
  | { type: "round:countdown"; roundId: string; startAt: number; maxGuesses: number }
  | { type: "room:closed" | "room:kicked" | "error"; message: string }
  | { type: "room:left" | "pong" }
  | { type: "round:started"; roundId: string; startAt: number; gameType?: GameType; clueStage?: number | null; stageEndsAt?: number | null }
  | { type: "guess:result"; bvid: string; attempt: number; cells: Cell[]; correct: boolean }
  | { type: "player:progress"; playerId: string; attempts: number; finished: boolean; clueStage?: number; clueSubmitted?: boolean }
  | { type: "clue:submitted"; stage: number; attempt: number; actionType: "guess" | "skip"; bvid?: string | null; name?: string | null }
  | { type: "clue:stage"; stage: number; stageEndsAt: number; clues: Array<{ key: string; label: string; value: string }> }
  | { type: "round:ended"; reason: RoundResult["reason"]; answer: Answer; winnerPlayerId: string | null; winnerPlayerIds?: string[]; gameType?: GameType; clues?: Array<{ key: string; label: string; value: string }>; players: Player[] };

const CATALOGS: Record<CatalogPool, Catalog> = {
  normal: searchSongsJson as Catalog,
  hardcore: hardcoreSearchSongsJson as Catalog,
};
const PINYIN_BY_POOL: Record<CatalogPool, Record<string, string>> = {
  normal: songPinyinJson as Record<string, string>,
  hardcore: hardcoreSongPinyinJson as Record<string, string>,
};
const SONGS_BY_POOL: Record<CatalogPool, SearchSong[]> = {
  normal: CATALOGS.normal.items.map((song) => ({
    ...song,
    searchPinyin: [PINYIN_BY_POOL.normal[song.bvid]].filter(Boolean),
  })),
  hardcore: CATALOGS.hardcore.items.map((song) => ({
    ...song,
    searchPinyin: [PINYIN_BY_POOL.hardcore[song.bvid]].filter(Boolean),
  })),
};
const STANDARD_BVIDS = new Set(SONGS_BY_POOL.normal.map((song) => song.bvid));
const SESSION_KEY = "aiyiba-pk-session-v1";
const NICKNAME_KEY = "aiyiba-pk-nickname-v1";
const DEVICE_KEY = "aiyiba-pk-device-v1";
const PENDING_LEAVE_KEY = "aiyiba-pk-pending-leave-v1";
const PK_STATS_KEY = "aiyiba-pk-stats-v1";
const PK_GUIDE_SEEN_KEY = "aiyiba-pk-guide-seen-v4";
const LABELS = ["作品", "演唱", "引擎", "歌名字数", "投稿日期", "播放等级"];
const CLUE_STAGE_LABELS = ["引擎", "播放等级", "演唱", "投稿年份", "歌名字数", "最终抢答"];
const RECONNECT_DELAYS = [1_000, 2_000, 3_000, 5_000];
const MODE_RULES: Record<GameMode, { label: string; maxGuesses: number; description: string }> = {
  normal: { label: "普通模式", maxGuesses: 6, description: "6 次机会" },
  hard: { label: "困难模式", maxGuesses: 4, description: "4 次机会" },
};
const POOL_RULES: Record<CatalogPool, { label: string; description: string }> = {
  normal: { label: "标准题库", description: `收录 ${CATALOGS.normal.items.length} 首作品` },
  hardcore: { label: "扩展题库", description: `收录 ${CATALOGS.hardcore.items.length} 首确认作品` },
};
const GAME_TYPE_RULES: Record<GameType, { label: string; description: string }> = {
  classic: { label: "经典推理", description: "比较六项线索，先猜中者获胜" },
  clues: { label: "线索阶梯", description: "共享线索逐层揭示，固定 6 次机会" },
};
const PK_CONFETTI_COLORS = ["#e14a42", "#f2b84b", "#2c9a78", "#4c72d9", "#d76ca7", "#fff4cf"];
const PK_CONFETTI_PIECES = Array.from({ length: 56 }, (_, index) => {
  const angle = index / 56 * Math.PI * 2;
  const distance = 210 + index % 8 * 31;
  const x = Math.round(Math.cos(angle) * distance);
  const y = Math.round(Math.sin(angle) * distance - 170 - index % 5 * 13);
  return {
    id: index,
    x,
    y,
    endX: Math.round(x * 1.14),
    endY: y + 430 + index % 6 * 22,
    rotation: 380 + index % 9 * 73,
    delay: index % 8 * 0.026,
    color: PK_CONFETTI_COLORS[index % PK_CONFETTI_COLORS.length],
  };
});
const EMPTY_PK_STATS = normalizePkStats(null) as PkStats;
const pkStatsListeners = new Set<() => void>();
const pkGuideListeners = new Set<() => void>();
let pkStatsSnapshot: PkStats | null = null;
let fallbackDeviceId = "";

function wsUrl() {
  if (typeof window === "undefined") return "";
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const local = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)
    || ["3000", "5173"].includes(window.location.port);
  return local
    ? `${protocol}://${window.location.hostname}:3001`
    : `${protocol}://${window.location.host}/pk/ws`;
}

function readSession() {
  try {
    const stored = localStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(SESSION_KEY);
    const value = JSON.parse(stored ?? "null");
    if (value?.code && value?.playerToken && value?.playerId) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(value));
      sessionStorage.removeItem(SESSION_KEY);
      return value as Session;
    }
  } catch {
    // A broken session should simply start a new room.
  }
  return null;
}

function saveSession(value: Session | null) {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    if (!value) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  } catch {
    // Storage may be unavailable in privacy-restricted browsers.
  }
}

function readPendingLeave() {
  try {
    return localStorage.getItem(PENDING_LEAVE_KEY) === "1";
  } catch {
    return false;
  }
}

function savePendingLeave(value: boolean) {
  try {
    if (value) localStorage.setItem(PENDING_LEAVE_KEY, "1");
    else localStorage.removeItem(PENDING_LEAVE_KEY);
  } catch {
    // A reconnect can still finish the leave when storage is unavailable.
  }
}

function readDeviceId() {
  if (fallbackDeviceId) return fallbackDeviceId;
  try {
    const existing = localStorage.getItem(DEVICE_KEY)?.trim();
    if (existing) {
      fallbackDeviceId = existing;
      return existing;
    }
    const created = globalThis.crypto?.randomUUID?.() ?? `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, created);
    fallbackDeviceId = created;
    return created;
  } catch {
    fallbackDeviceId = `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return fallbackDeviceId;
  }
}

function readNickname() {
  try {
    return localStorage.getItem(NICKNAME_KEY)?.trim().slice(0, 18) ?? "";
  } catch {
    return "";
  }
}

function saveNickname(value: string) {
  try {
    localStorage.setItem(NICKNAME_KEY, value);
  } catch {
    // Browsers that block local storage can still use PK without persistence.
  }
}

function readPkStats() {
  if (pkStatsSnapshot) return pkStatsSnapshot;
  try {
    pkStatsSnapshot = normalizePkStats(JSON.parse(localStorage.getItem(PK_STATS_KEY) ?? "null")) as PkStats;
  } catch {
    pkStatsSnapshot = EMPTY_PK_STATS;
  }
  return pkStatsSnapshot;
}

function savePkStats(value: PkStats) {
  pkStatsSnapshot = value;
  try {
    localStorage.setItem(PK_STATS_KEY, JSON.stringify(value));
  } catch {
    // Keep the in-memory copy when storage is unavailable.
  }
  for (const listener of pkStatsListeners) listener();
}

function subscribePkStats(listener: () => void) {
  pkStatsListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== PK_STATS_KEY) return;
    pkStatsSnapshot = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    pkStatsListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function hasSeenPkGuide() {
  try {
    return localStorage.getItem(PK_GUIDE_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markPkGuideSeen() {
  try {
    localStorage.setItem(PK_GUIDE_SEEN_KEY, "1");
  } catch {
    // The guide can still be dismissed for this render.
  }
  for (const listener of pkGuideListeners) listener();
}

function subscribePkGuide(listener: () => void) {
  pkGuideListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === PK_GUIDE_SEEN_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    pkGuideListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function subscribeNickname() {
  return () => {};
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function formatTier(value: string) {
  return value.replace(/曲$/u, "");
}

function normalizePool(value: unknown): CatalogPool {
  return value === "hardcore" || value === "extended" ? "hardcore" : "normal";
}

function formatViews(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "播放量待核";
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 1_000_000 ? 0 : 1)}万`;
  return value.toLocaleString("zh-CN");
}

export default function PkPage() {
  const socketRef = useRef<WebSocket | null>(null);
  const pendingLeaveRef = useRef(readPendingLeave());
  const guessPendingRef = useRef(false);
  const [connection, setConnection] = useState<"connecting" | "connected" | "offline">("connecting");
  const [room, setRoom] = useState<Room | null>(null);
  const [playerId, setPlayerId] = useState("");
  const savedNickname = useSyncExternalStore(subscribeNickname, readNickname, () => "");
  const [nameInput, setName] = useState<string | null>(null);
  const name = nameInput ?? savedNickname;
  const [joinCode, setJoinCode] = useState("");
  const [query, setQuery] = useState("");
  const [selectedBvid, setSelectedBvid] = useState<string | null>(null);
  const [rows, setRows] = useState<GuessRow[]>([]);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [requiresRefresh, setRequiresRefresh] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [startTab, setStartTab] = useState<"lobby" | "code">("lobby");
  const [selectedMode, setSelectedMode] = useState<GameMode>("normal");
  const [selectedPool, setSelectedPool] = useState<CatalogPool>("normal");
  const [selectedGameType, setSelectedGameType] = useState<GameType>("classic");
  const [clueActions, setClueActions] = useState<NonNullable<Player["clueActions"]>>([]);
  const [lobbyRooms, setLobbyRooms] = useState<LobbyRoom[]>([]);
  const [sharedSessionPresent, setSharedSessionPresent] = useState(false);
  const [lobbyFilter, setLobbyFilter] = useState<"all" | GameMode>("all");
  const pkStats = useSyncExternalStore(subscribePkStats, readPkStats, () => EMPTY_PK_STATS);
  const pkGuideSeen = useSyncExternalStore(subscribePkGuide, hasSeenPkGuide, () => true);
  const [statsMode, setStatsMode] = useState<GameMode>("normal");
  const [statsPool, setStatsPool] = useState<CatalogPool>("normal");
  const [statsGameType, setStatsGameType] = useState<GameType>("classic");
  const [showPkStats, setShowPkStats] = useState(false);
  const [showPkRules, setShowPkRules] = useState(false);
  const [guideManuallyOpen, setGuideManuallyOpen] = useState(false);
  const [shareCard, setShareCard] = useState<ShareCardModel | null>(null);
  const [leavingRoom, setLeavingRoom] = useState(false);
  const [guessPending, setGuessPending] = useState(false);

  const me = room?.players.find((player) => player.id === playerId);
  const activePool = normalizePool(room?.pool ?? selectedPool);
  const activeGameType: GameType = room?.gameType === "clues" ? "clues" : room?.gameType === "classic" ? "classic" : selectedGameType;
  const activeCatalog = CATALOGS[activePool];
  const guessed = useMemo(() => new Set([
    ...rows.map((row) => row.bvid),
    ...clueActions.filter((action) => action.type === "guess" && action.bvid).map((action) => action.bvid as string),
  ]), [clueActions, rows]);
  const matches = useMemo(() => {
    const needle = normalizeSearchText(query);
    if (!needle || !room || room.status !== "playing") return [];
    return SONGS_BY_POOL[activePool].filter((song) => !guessed.has(song.bvid) && matchesSongQuery(song, needle)).slice(0, 8);
  }, [activePool, query, room, guessed]);
  const countdown = room?.status === "countdown" && room.countdownEndsAt
    ? Math.max(1, Math.ceil((room.countdownEndsAt - now) / 1_000))
    : null;
  const clueCountdown = activeGameType === "clues" && room?.status === "playing" && room.stageEndsAt
    ? Math.max(0, Math.ceil((room.stageEndsAt - now) / 1_000))
    : null;

  useEffect(() => {
    if (!room || room.status !== "ended" || !room.roundId || !room.result) return;
    if (pkStats.recordedRoundIds.includes(room.roundId)) return;
    const player = room.result.players.find((item) => item.id === playerId);
    if (!player) return;
    const winnerIds = room.result.winnerPlayerIds ?? (room.result.winnerPlayerId ? [room.result.winnerPlayerId] : []);
    const outcome = winnerIds.includes(playerId) ? "win" : winnerIds.length ? "loss" : "draw";
    const next = recordPkRound(pkStats, {
      roundId: room.roundId,
      pool: normalizePool(room.pool),
      mode: room.mode,
      gameType: activeGameType,
      outcome,
      attempts: player.attempts,
      wonByGuess: outcome === "win" && room.result.reason === "correct",
    }) as PkStats;
    savePkStats(next);
  }, [activeGameType, pkStats, playerId, room]);

  function send(type: string, data: Record<string, unknown> = {}) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("还没有连接到 PK 服务，请确认多人服务已经启动");
      return false;
    }
    try {
      socket.send(JSON.stringify({ type, ...data }));
      return true;
    } catch {
      setConnection("offline");
      setError("连接已断开，正在自动重连…");
      return false;
    }
  }

  function clearLocalRoom() {
    savePendingLeave(false);
    pendingLeaveRef.current = false;
    setLeavingRoom(false);
    guessPendingRef.current = false;
    setGuessPending(false);
    saveSession(null);
    setRoom(null);
    setPlayerId("");
    setRows([]);
    setClueActions([]);
    setAnswer(null);
    setQuery("");
    setSelectedBvid(null);
    setSelectedMode("normal");
    setSelectedPool("normal");
    setSelectedGameType("classic");
  }

  function handleMessage(message: ServerMessage) {
    if (message.type === "room:created" || message.type === "room:joined") {
      const session = { code: message.code, playerToken: message.playerToken, playerId: message.playerId };
      const acceptedName = message.room.players.find((player) => player.id === message.playerId)?.name;
      saveSession(session);
      savePendingLeave(false);
      pendingLeaveRef.current = false;
      setLeavingRoom(false);
      setRequiresRefresh(false);
      if (acceptedName) {
        setName(acceptedName);
        saveNickname(acceptedName);
      }
      setPlayerId(message.playerId);
      setRoom(message.room);
      setSelectedMode(message.room.mode ?? "normal");
      setSelectedPool(normalizePool(message.room.pool));
      setSelectedGameType(message.room.gameType === "clues" ? "clues" : "classic");
      setRows([]);
      setClueActions([]);
      setAnswer(null);
      setError("");
      setNotice("");
      return;
    }
    if (message.type === "lobby:snapshot") {
      setLobbyRooms(message.rooms ?? []);
      return;
    }
    if (message.type === "room:reconnected") {
      setSharedSessionPresent(false);
      setPlayerId(message.playerId);
      setRoom(message.room);
      setSelectedMode(message.room.mode ?? "normal");
      setSelectedPool(normalizePool(message.room.pool));
      setSelectedGameType(message.room.gameType === "clues" ? "clues" : "classic");
      if (message.room.answer) setAnswer(message.room.answer);
      setError("");
      setNotice("已重新连接到房间");
      setRequiresRefresh(false);
      if (pendingLeaveRef.current) {
        setLeavingRoom(true);
        setNotice("正在退出房间…");
        send("room:leave");
      }
      return;
    }
    if (message.type === "room:active-elsewhere") {
      setSharedSessionPresent(true);
      setNotice("这个浏览器已在另一个标签页参赛。你可以回到原页面，或在本页接管连接。");
      return;
    }
    if (message.type === "room:reconnect-failed") {
      clearLocalRoom();
      setError("");
      setNotice(message.message === "重连凭据无效" ? "原房间已经释放，可以重新加入" : message.message ?? "原房间已经失效");
      send("lobby:subscribe");
      return;
    }
    if (message.type === "room:forfeit-summary") {
      const next = recordPkRound(readPkStats(), {
        roundId: message.roundId,
        pool: normalizePool(message.pool),
        mode: message.mode,
        gameType: message.gameType,
        outcome: "loss",
        attempts: message.attempts,
        wonByGuess: false,
      }) as PkStats;
      savePkStats(next);
      clearLocalRoom();
      setError("");
      setNotice(message.message || "断线时间过长，本局已记为失败");
      send("lobby:subscribe");
      return;
    }
    if (message.type === "service:maintenance") {
      setRequiresRefresh(true);
      setNotice(message.message || ROUND_INVALIDATED_MESSAGE);
      return;
    }
    if (message.type === "service:resumed") {
      setNotice(message.message);
      return;
    }
    if (message.type === "room:state") {
      setRoom(message);
      if (message.mode === "normal" || message.mode === "hard") setSelectedMode(message.mode);
      setSelectedPool(normalizePool(message.pool));
      setSelectedGameType(message.gameType === "clues" ? "clues" : "classic");
      if (message.answer) setAnswer(message.answer);
      return;
    }
    if (message.type === "round:history") {
      setRows(message.rows ?? []);
      setClueActions(message.actions ?? []);
      return;
    }
    if (message.type === "round:countdown") {
      guessPendingRef.current = false;
      setGuessPending(false);
      setRows([]);
      setClueActions([]);
      setAnswer(null);
      setShareCard(null);
      setNotice("所有玩家已准备，马上开始");
      return;
    }
    if (message.type === "room:closed") {
      clearLocalRoom();
      setError(message.message ?? "房间已经解散");
      send("lobby:subscribe");
      return;
    }
    if (message.type === "room:kicked") {
      clearLocalRoom();
      setError("");
      setNotice(message.message ?? "你已被房主移出房间");
      send("lobby:subscribe");
      return;
    }
    if (message.type === "room:left") {
      clearLocalRoom();
      setError("");
      setNotice("");
      send("lobby:subscribe");
      return;
    }
    if (message.type === "round:started") {
      guessPendingRef.current = false;
      setGuessPending(false);
      setRoom((current) => current ? {
        ...current,
        status: "playing",
        startAt: message.startAt,
        countdownEndsAt: message.startAt,
        gameType: message.gameType ?? current.gameType,
        clueStage: message.clueStage ?? current.clueStage,
        stageEndsAt: message.stageEndsAt ?? current.stageEndsAt,
      } : current);
      setNotice("");
      return;
    }
    if (message.type === "clue:submitted") {
      setGuessPending(false);
      guessPendingRef.current = false;
      setError("");
      setClueActions((current) => [...current, {
        stage: message.stage,
        type: message.actionType,
        bvid: message.bvid ?? null,
        name: message.name ?? null,
      }]);
      setRoom((current) => current ? {
        ...current,
        players: current.players.map((player) => player.id === playerId
          ? { ...player, attempts: message.attempt, clueSubmitted: true }
          : player),
      } : current);
      setQuery("");
      setSelectedBvid(null);
      return;
    }
    if (message.type === "clue:stage") {
      setRoom((current) => current ? { ...current, clueStage: message.stage, stageEndsAt: message.stageEndsAt, clues: message.clues, players: current.players.map((player) => ({ ...player, clueSubmitted: false })) } : current);
      setQuery("");
      setSelectedBvid(null);
      setGuessPending(false);
      guessPendingRef.current = false;
      return;
    }
    if (message.type === "guess:result") {
      guessPendingRef.current = false;
      setGuessPending(false);
      setError("");
      setRows((current) => [...current, {
        bvid: message.bvid,
        attempt: message.attempt,
        cells: message.cells,
        correct: Boolean(message.correct),
      }]);
      setQuery("");
      setSelectedBvid(null);
      return;
    }
    if (message.type === "player:progress") {
      setRoom((current) => current ? {
        ...current,
        players: current.players.map((player) => player.id === message.playerId
          ? { ...player, attempts: message.attempts, finished: message.finished, clueStage: message.clueStage ?? player.clueStage, clueSubmitted: message.clueSubmitted ?? player.clueSubmitted }
          : player),
      } : current);
      return;
    }
    if (message.type === "round:ended") {
      guessPendingRef.current = false;
      setGuessPending(false);
      setAnswer(message.answer);
      setRoom((current) => current ? {
        ...current,
        status: "ended",
        winnerPlayerId: message.winnerPlayerId,
        winnerPlayerIds: message.winnerPlayerIds,
        gameType: message.gameType ?? current.gameType,
        clues: message.clues ?? current.clues,
        players: message.players ?? current.players,
        result: {
          reason: message.reason,
          winnerPlayerId: message.winnerPlayerId,
          winnerPlayerIds: message.winnerPlayerIds,
          gameType: message.gameType ?? current.gameType,
          clues: message.clues ?? current.clues,
          players: message.players ?? current.players,
        },
      } : current);
      const ownResult = message.players?.find((player) => player.id === playerId);
      if (ownResult?.clueActions) setClueActions(ownResult.clueActions);
      setNotice("");
      return;
    }
    if (message.type === "pong") return;
    if (message.type === "error") {
      if (guessPendingRef.current) {
        guessPendingRef.current = false;
        setGuessPending(false);
      }
      setError(message.message ?? "请求失败");
    }
  }

  useEffect(() => {
    let disposed = false;
    let retryAttempt = 0;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (disposed) return;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      setConnection("connecting");
      const socket = new WebSocket(wsUrl());
      socketRef.current = socket;
      socket.onopen = () => {
        if (disposed || socketRef.current !== socket) return;
        const recovered = retryAttempt > 0;
        retryAttempt = 0;
        setConnection("connected");
        if (recovered) setNotice("连接已恢复");
        const session = readSession();
        if (session) socket.send(JSON.stringify({ type: "room:reconnect", code: session.code, playerToken: session.playerToken, deviceId: readDeviceId() }));
        else socket.send(JSON.stringify({ type: "lobby:subscribe" }));
      };
      socket.onmessage = (event) => {
        try {
          handleMessage(JSON.parse(event.data) as ServerMessage);
        } catch {
          setError("收到无法识别的服务消息");
        }
      };
      socket.onerror = () => setConnection("offline");
      socket.onclose = (event) => {
        if (disposed || socketRef.current !== socket) return;
        socketRef.current = null;
        guessPendingRef.current = false;
        setGuessPending(false);
        setConnection("offline");
        if (event.code === 4001) {
          setSharedSessionPresent(true);
          setNotice("连接已在另一个标签页接管");
          return;
        }
        const delay = RECONNECT_DELAYS[Math.min(retryAttempt, RECONNECT_DELAYS.length - 1)];
        retryAttempt += 1;
        setNotice(`连接已断开，${Math.ceil(delay / 1_000)} 秒后自动重连…`);
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
    };
    // This connection is intentionally created once; message handling only writes through state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SESSION_KEY) return;
      const active = Boolean(event.newValue);
      setSharedSessionPresent(active);
      if (active) setNotice("这个浏览器已在另一个标签页加入房间，请在原页面继续");
      else setNotice("");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!room || !["countdown", "playing"].includes(room.status)) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [room]);

  function createRoom(visibility: "public" | "private") {
    setError("");
    const creatorName = name.trim();
    if (!creatorName) {
      setError("请先输入昵称再创建房间");
      return;
    }
    saveNickname(creatorName);
    send("room:create", { name: creatorName, mode: "normal", pool: "normal", gameType: "classic", visibility, deviceId: readDeviceId() });
  }

  function updateRoomSettings(mode: GameMode, pool: CatalogPool, gameType: GameType = activeGameType) {
    if (!room || !me?.isHost || room.status !== "lobby") return;
    const normalizedMode = gameType === "clues" ? "normal" : mode;
    if (room.gameType === gameType && room.mode === normalizedMode && normalizePool(room.pool) === pool) return;
    if (send("room:update-settings", { mode: normalizedMode, pool, gameType })) {
      setNotice("房间设置已更新，请所有人重新准备");
    }
  }

  function joinRoom(code = joinCode) {
    setError("");
    if (!code.trim()) {
      setError("请先输入房间码");
      return;
    }
    if (!name.trim()) {
      setError("请先输入昵称再加入房间");
      return;
    }
    saveNickname(name.trim());
    send("room:join", { code: code.trim().toUpperCase(), name: name.trim(), deviceId: readDeviceId() });
  }

  function takeOverSession() {
    const session = readSession();
    if (!session) {
      setSharedSessionPresent(false);
      setNotice("原房间凭据已经清除，可以重新加入");
      return;
    }
    setError("");
    send("room:reconnect", {
      code: session.code,
      playerToken: session.playerToken,
      deviceId: readDeviceId(),
      takeover: true,
    });
  }

  function leaveRoom() {
    if (leavingRoom || pendingLeaveRef.current) return;
    if (room?.roundId && ["countdown", "playing"].includes(room.status)) {
      const player = room.players.find((item) => item.id === playerId);
      const next = recordPkRound(pkStats, {
        roundId: room.roundId,
        pool: normalizePool(room.pool),
        mode: room.mode,
        gameType: activeGameType,
        outcome: "loss",
        attempts: player?.attempts ?? 0,
        wonByGuess: false,
      }) as PkStats;
      savePkStats(next);
    }
    savePendingLeave(true);
    pendingLeaveRef.current = true;
    if (send("room:leave")) {
      setLeavingRoom(true);
      setError("");
      setNotice("正在退出房间…");
    } else {
      setNotice("连接恢复后会自动退出房间");
    }
  }

  async function copyInvite() {
    try {
      if (!room) return;
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("复制失败，请手动复制房间码");
    }
  }

  function shareResult() {
    if (!answer || !room) return;
    setShareCard(buildPkShareCardModel({
      poolLabel: activePoolRules.label,
      modeLabel: activeRules.label,
      gameType: activeGameType,
      outcome,
      answer,
      players: resultPlayers,
      currentPlayerId: playerId,
      winnerPlayerId: resultWinnerId,
      winnerPlayerIds: resultWinnerIds,
      clues: room.clues ?? [],
    }) as ShareCardModel);
  }

  function dismissPkGuide() {
    markPkGuideSeen();
    setGuideManuallyOpen(false);
  }

  function resetPkStats() {
    if (!window.confirm("清除本机多人模式战绩？房间和昵称不会受影响。")) return;
    savePkStats(normalizePkStats(null) as PkStats);
  }

  function submitGuess() {
    if (!selectedBvid || room?.status !== "playing" || guessPendingRef.current) return;
    guessPendingRef.current = true;
    setGuessPending(true);
    setError("");
    if (!send("guess:submit", { bvid: selectedBvid })) {
      guessPendingRef.current = false;
      setGuessPending(false);
    }
  }

  function skipClue() {
    if (activeGameType !== "clues" || room?.status !== "playing" || guessPendingRef.current) return;
    guessPendingRef.current = true;
    setGuessPending(true);
    setError("");
    if (!send("clue:skip")) {
      guessPendingRef.current = false;
      setGuessPending(false);
    }
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (selectedBvid) submitGuess();
      else if (matches[0]) {
        setSelectedBvid(matches[0].bvid);
        setQuery(matches[0].name);
      }
    }
    if (event.key === "Escape") {
      setQuery("");
      setSelectedBvid(null);
    }
  }

  const filteredLobbyRooms = lobbyRooms.filter((item) => lobbyFilter === "all" || item.mode === lobbyFilter);
  const waitingRooms = filteredLobbyRooms.filter((item) => item.joinable);
  const liveRooms = filteredLobbyRooms.filter((item) => !item.joinable && ["lobby", "countdown", "playing"].includes(item.status));
  const activeMode = room?.mode ?? selectedMode;
  const activeRules = MODE_RULES[activeMode];
  const activePoolRules = POOL_RULES[activePool];
  const screen = !room
    ? "start"
    : room.status === "lobby"
      ? "lobby"
      : ["countdown", "playing"].includes(room.status)
        ? "game"
        : "ended";
  const resultPlayers = room?.result?.players ?? room?.players ?? [];
  const resultWinnerId = room?.result?.winnerPlayerId ?? room?.winnerPlayerId ?? null;
  const resultWinnerIds = room?.result?.winnerPlayerIds ?? room?.winnerPlayerIds ?? (resultWinnerId ? [resultWinnerId] : []);
  const resultReason = room?.result?.reason ?? (resultWinnerId ? "correct" : "draw");
  const extendedOnlyAnswer = answer ? isExtendedOnlySong(activePool, answer.bvid, STANDARD_BVIDS) : false;
  const winner = resultWinnerIds.length ? resultPlayers.find((player) => player.id === resultWinnerIds[0]) : null;
  const isPlayerWinner = Boolean(playerId) && resultWinnerIds.includes(playerId);
  const outcome = isPlayerWinner ? (resultWinnerIds.length > 1 ? "你们并列获胜！" : "你赢了！") : resultWinnerIds.length ? "这局惜败" : "平局";
  const resultSubtitle = resultReason === "draw"
    ? "所有玩家都没有在机会用完前猜中"
    : resultReason === "disconnect"
      ? `${winner?.name ?? "留在房间的玩家"} 因对手掉线获胜`
      : resultReason === "forfeit"
        ? `${winner?.name ?? "留在房间的玩家"} 因对手退出获胜`
        : activeGameType === "clues"
          ? `${resultWinnerIds.length > 1 ? "有玩家在同一层" : winner?.name ?? "玩家"} 猜中了答案`
          : `${winner?.name ?? "对手"} 先猜中了答案`;
  const victoryMessage = resultReason === "forfeit"
    ? "对手退出，本局获胜"
    : resultReason === "disconnect"
      ? "对手掉线，本局获胜"
      : activeGameType === "clues"
        ? "同层猜中，拿下这一局！"
        : "率先猜中，拿下这一局！";
  const activePkStats = statsGameType === "clues" ? pkStats.pools[statsPool].clues : pkStats.pools[statsPool].modes[statsMode];
  const pkWinRate = activePkStats.played ? Math.round(activePkStats.wins / activePkStats.played * 100) : 0;
  const averageGuesses = activePkStats.played ? (activePkStats.totalGuesses / activePkStats.played).toFixed(1) : "0.0";
  const showPkGuide = guideManuallyOpen || !pkGuideSeen;
  const allPlayersReady = Boolean(room?.players.length) && room?.players.every((player) => player.ready && player.connected);
  const canStart = room?.status === "lobby" && room.players.length >= 2 && allPlayersReady;

  const modalOpen = showPkGuide || showPkRules || showPkStats;
  useEffect(() => {
    if (!modalOpen) return undefined;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => dialog
      ? [...dialog.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true")
      : [];
    focusable()[0]?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (showPkGuide) dismissPkGuide();
        else if (showPkRules) setShowPkRules(false);
        else setShowPkStats(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const elements = focusable();
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [modalOpen, showPkGuide, showPkRules, showPkStats]);

  return (
    <main className="pk-shell">
      <header className="topbar pk-topbar">
        <div className="brand" aria-label="哎一把">
          <a className="brand-note" href="https://space.bilibili.com/3379951" target="_blank" rel="noreferrer" aria-label="访问 ilem B站个人主页">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ilem-avatar.jpg" alt="ilem头像" />
          </a>
          <span>哎一把 · 多人模式</span>
        </div>
        <div className="pk-topbar-actions">
          <button type="button" onClick={() => setGuideManuallyOpen(true)}>说明</button>
          <button type="button" onClick={() => setShowPkStats(true)}>战绩</button>
          <Link className="pk-back-link" href="/" aria-label="返回主页"><span aria-hidden="true">↩</span><span>主页</span></Link>
        </div>
      </header>

      {screen === "ended" && isPlayerWinner && (
        <div className="confetti-burst" aria-hidden="true">
          {PK_CONFETTI_PIECES.map((piece) => (
            <i className="confetti-piece" key={piece.id} style={{
              "--x": `${piece.x}px`, "--y": `${piece.y}px`, "--end-x": `${piece.endX}px`,
              "--end-y": `${piece.endY}px`, "--rotation": `${piece.rotation}deg`,
              "--delay": `${piece.delay}s`, "--confetti-color": piece.color,
            } as CSSProperties} />
          ))}
        </div>
      )}

      <section className="pk-hero">
        <h1>叫上朋友，谁先认出这首歌？</h1>
        <p>2–8 人同时猜同一首 ilem 作品；经典推理先猜中者获胜，线索阶梯同层猜中者并列获胜。服务器同时最多保留 15 个房间。</p>
        <div className={`pk-connection ${connection}`}><i />{connection === "connected" ? "PK 服务已连接" : connection === "connecting" ? "正在连接 PK 服务…" : "PK 服务未连接"}</div>
      </section>

      {error && <div className="pk-alert error" role="alert">{error}</div>}
      {notice && <div className={`pk-alert${requiresRefresh ? " update" : ""}`} role={requiresRefresh ? "alert" : "status"}><span>{notice}</span>{requiresRefresh && <button type="button" onClick={() => window.location.reload()}>刷新后继续游玩</button>}</div>}

      {screen === "start" && (
        <section className="pk-card pk-start-card">
          <div className="pk-card-heading"><h2>找朋友一起猜 ilem 的作品</h2></div>
          <label className="pk-field">参赛昵称<input value={name} maxLength={18} onChange={(event) => setName(event.target.value)} placeholder="例如：国风轻电子" aria-required="true" /><small>创建或加入房间前必须填写昵称</small></label>
          {sharedSessionPresent && <div className="pk-browser-session-warning" role="status"><span>这个浏览器已经在另一个标签页参赛。请回到原页面继续；如果原页面已经关闭，也可以在这里接管连接。</span><button type="button" onClick={takeOverSession}>在本页接管</button></div>}
          <nav className="pk-lobby-tabs" aria-label="多人大厅功能">
            <button className={startTab === "lobby" ? "active" : ""} type="button" onClick={() => setStartTab("lobby")}>公开大厅</button>
            <button className={startTab === "code" ? "active" : ""} type="button" onClick={() => setStartTab("code")}>房间码</button>
          </nav>

          {startTab === "lobby" && <div className="pk-public-lobby">
            <div className="pk-lobby-toolbar"><div><strong>多人公开房间</strong><span>{waitingRooms.length} 个等待中 · {liveRooms.length} 个已开始</span></div><button type="button" aria-label="创建公开房间" onClick={() => createRoom("public")} disabled={connection !== "connected" || sharedSessionPresent || !name.trim()} title={!name.trim() ? "请先填写昵称" : undefined}>创建公开房间</button></div>
            <div className="pk-lobby-filter" role="group" aria-label="筛选公开房间难度">
              <span>显示房间</span>
              <button type="button" className={lobbyFilter === "all" ? "active" : ""} aria-pressed={lobbyFilter === "all"} onClick={() => setLobbyFilter("all")}>全部</button>
              <button type="button" className={lobbyFilter === "normal" ? "active" : ""} aria-pressed={lobbyFilter === "normal"} onClick={() => setLobbyFilter("normal")}>普通</button>
              <button type="button" className={lobbyFilter === "hard" ? "active" : ""} aria-pressed={lobbyFilter === "hard"} onClick={() => setLobbyFilter("hard")}>困难</button>
            </div>
            <section className="pk-lobby-section">
              <header><strong>等待加入</strong><span>选择一个还没满员的房间</span></header>
              {waitingRooms.length ? <div className="pk-lobby-room-list">{waitingRooms.map((item) => <article className="pk-lobby-room" key={item.code}><div><strong>{item.hostName}</strong><span>{item.gameType === "clues" ? GAME_TYPE_RULES.clues.label : GAME_TYPE_RULES.classic.label} · {item.poolLabel ?? POOL_RULES[normalizePool(item.pool)].label} · {item.gameType === "clues" ? "固定 6 次" : MODE_RULES[item.mode].label} · {item.playerCount}/{item.maxPlayers} 人</span></div><code>{item.code}</code><button type="button" onClick={() => joinRoom(item.code)} disabled={sharedSessionPresent}>加入房间</button></article>)}</div> : <p className="pk-lobby-empty">暂时没有等待中的房间，可以创建一个邀请朋友加入。</p>}
            </section>
            <section className="pk-lobby-section">
              <header><strong>正在进行</strong><span>比赛中不能加入</span></header>
              {liveRooms.length ? <div className="pk-lobby-room-list">{liveRooms.map((item) => <article className="pk-lobby-room live" key={item.code}><div><strong>{item.players.map((player) => player.name).join("、")}</strong><span>{item.gameType === "clues" ? GAME_TYPE_RULES.clues.label : GAME_TYPE_RULES.classic.label} · {item.poolLabel ?? POOL_RULES[normalizePool(item.pool)].label} · {item.gameType === "clues" ? "固定 6 次" : MODE_RULES[item.mode].label} · {item.playerCount}/{item.maxPlayers} 人 · {item.status === "lobby" ? "等待准备" : item.status === "countdown" ? "即将开始" : "比赛进行中"}</span></div><em>暂不可加入</em></article>)}</div> : <p className="pk-lobby-empty">目前还没有正在进行的多人比赛。</p>}
            </section>
          </div>}

          {startTab === "code" && <div className="pk-code-room">
            <button className="pk-private-create" type="button" onClick={() => createRoom("private")} disabled={connection !== "connected" || sharedSessionPresent || !name.trim()} title={!name.trim() ? "请先填写昵称" : undefined}>创建私密房间</button>
            <span>最多 8 人，不开放观战；创建房间前请先填写昵称。</span>
            <div className="pk-join"><input value={joinCode} maxLength={6} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="输入房间码" aria-label="输入房间码" /><button type="button" onClick={() => joinRoom()} disabled={connection !== "connected" || joinCode.trim().length !== 6 || sharedSessionPresent}>加入</button></div>
          </div>}
          <p className="pk-fine-print">多人模式 · 2–8 人 · 创建房间后由房主选择玩法和题库；经典推理再选择难度。</p>
        </section>
      )}

      {screen === "lobby" && room && (
        <section className="pk-card pk-lobby-card">
          <div className="pk-room-code"><div><strong>{room.code}</strong><span>{room.visibility === "public" ? "公开大厅中的玩家也可以加入" : "把这个房间码发给朋友"} · {GAME_TYPE_RULES[activeGameType].label} · {room.poolLabel ?? activePoolRules.label} · {activeGameType === "clues" ? "固定 6 次" : activeRules.label} · 最多 {room.maxPlayers} 人</span></div><button type="button" onClick={copyInvite}>{copied ? "已复制邀请码" : "复制邀请码"}</button></div>
          <div className="pk-room-settings">
            <div className="pk-room-settings-heading"><strong>房间设置</strong><span>{me?.isHost ? "你是房主，可以在开始前选择玩法和题库；经典推理还可以选择难度。修改后所有人需要重新准备。" : "玩法和题库由房主决定；经典推理的难度也由房主决定。"}</span></div>
            {me?.isHost ? <>
              <div className="mode-bar pk-mode-bar pk-room-mode-bar">
                <div className="mode-copy"><strong>玩法</strong><span>{GAME_TYPE_RULES[activeGameType].description}</span></div>
                <div className="mode-actions" role="group" aria-label="选择多人玩法">
                  <button type="button" className={activeGameType === "classic" ? "active" : ""} aria-pressed={activeGameType === "classic"} onClick={() => updateRoomSettings(room.mode, normalizePool(room.pool), "classic")}>经典推理</button>
                  <button type="button" className={activeGameType === "clues" ? "active" : ""} aria-pressed={activeGameType === "clues"} onClick={() => updateRoomSettings("normal", normalizePool(room.pool), "clues")}>线索阶梯</button>
                </div>
              </div>
              {activeGameType === "classic" && <div className="mode-bar pk-mode-bar pk-room-mode-bar">
                <div className="mode-copy"><strong>难度</strong><span>{MODE_RULES[room.mode].description}</span></div>
                <div className="mode-actions" role="group" aria-label="选择多人难度">
                  <button type="button" className={room.mode === "normal" ? "active" : ""} aria-pressed={room.mode === "normal"} onClick={() => updateRoomSettings("normal", normalizePool(room.pool))}>普通</button>
                  <button type="button" className={room.mode === "hard" ? "active" : ""} aria-pressed={room.mode === "hard"} onClick={() => updateRoomSettings("hard", normalizePool(room.pool))}>困难</button>
                </div>
              </div>}
              <div className="mode-bar pk-mode-bar pk-room-mode-bar">
                <div className="mode-copy"><strong>题库</strong><span>{POOL_RULES[normalizePool(room.pool)].description}</span></div>
                <div className="mode-actions" role="group" aria-label="选择多人题库">
                  <button type="button" className={normalizePool(room.pool) === "normal" ? "active" : ""} aria-pressed={normalizePool(room.pool) === "normal"} onClick={() => updateRoomSettings(room.mode, "normal")}>标准</button>
                  <button type="button" className={normalizePool(room.pool) === "hardcore" ? "active" : ""} aria-pressed={normalizePool(room.pool) === "hardcore"} onClick={() => updateRoomSettings(room.mode, "hardcore")}>扩展</button>
                </div>
              </div>
            </> : <p className="pk-room-settings-readonly">本房间使用 <strong>{GAME_TYPE_RULES[activeGameType].label}</strong> · <strong>{room.poolLabel ?? activePoolRules.label}</strong> · <strong>{activeGameType === "clues" ? "固定 6 次机会" : activeRules.label}</strong>。等待房主开始。</p>}
          </div>
          <div className="pk-player-list">{room.players.map((player, index) => <div className="pk-player" key={player.id}><span className={`pk-player-dot ${player.connected ? "online" : "offline"}`} /><div><strong>{player.name}{player.id === playerId ? "（你）" : ""}</strong><small>{player.ready ? "已准备" : "等待准备"}</small></div><em>{player.isHost ? "房主" : `玩家 ${index + 1}`}</em>{me?.isHost && !player.isHost && <button className="pk-kick-button" type="button" onClick={() => send("room:kick", { targetPlayerId: player.id })}>移出</button>}</div>)}</div>
          <p className="pk-multiplayer-capacity">当前 <strong>{room.players.length}/{room.maxPlayers}</strong> 人 · 所有人准备后由房主开始</p>
          {room.players.length < 2 && <p className="pk-waiting">等待另一位玩家加入…</p>}
          <button className="pk-ready-button" type="button" onClick={() => send("player:ready", { ready: !me?.ready })}>{me?.ready ? "已准备，点击可取消" : "准备开始"}</button>
          {me?.isHost ? <button className="pk-multiplayer-start" type="button" disabled={!canStart} onClick={() => send("round:start")}>{room.players.length < 2 ? "至少需要 2 人" : allPlayersReady ? "开始多人游戏" : "等待所有玩家准备"}</button> : <p className="pk-waiting">准备完成后，等待房主开始多人游戏。</p>}
          <button className="pk-text-button" type="button" onClick={leaveRoom}>退出房间</button>
        </section>
      )}

      {screen === "game" && room && (
        <section className="pk-card pk-game-card">
          <div className="pk-duel-head"><div><h2>{room.status === "countdown" ? `${countdown} 秒后开始` : activeGameType === "clues" ? "线索阶梯" : "猜得越快越好"}</h2><p className="pk-mode-caption">多人模式 · {GAME_TYPE_RULES[activeGameType].label} · {room.poolLabel ?? activePoolRules.label} · {activeGameType === "clues" ? "固定 6 次机会" : `${activeRules.label} · ${room.maxGuesses} 次机会`}</p></div><div className="pk-scoreboard multiplayer">{room.players.map((player) => <span key={player.id}><i className={player.id === playerId ? "self" : ""} />{player.name}{player.left ? "（已弃权）" : player.id === playerId ? "（你）" : ""}<b>{player.attempts}/{room.maxGuesses}</b></span>)}</div></div>
          {room.status === "countdown" ? <div className="pk-countdown" aria-live="polite"><strong>{countdown}</strong><span>所有玩家同时开始</span></div> : activeGameType === "clues" ? <div className="pk-clue-game">
            <div className="pk-clue-stage-head"><div><small>第 {room.clueStage ?? 1} / 6 层 · {CLUE_STAGE_LABELS[Math.max(0, (room.clueStage ?? 1) - 1)]}</small><h3>{room.clueStage === 6 ? "最终抢答" : "看清线索，再决定要不要抢答"}</h3></div><strong>{clueCountdown ?? 0}<small> 秒</small></strong></div>
            <div className="pk-clue-list">{(room.clues ?? []).map((clue) => <div className="pk-clue-item" key={clue.key}><span>{clue.label}</span><strong>{clue.value}</strong></div>)}{!(room.clues ?? []).length && <div className="pk-clue-item muted"><span>第一层线索</span><strong>马上揭示</strong></div>}</div>
            <div className="pk-clue-player-status">{room.players.map((player) => <span key={player.id} className={player.clueSubmitted ? "submitted" : ""}><i />{player.name}{player.id === playerId ? "（你）" : ""}<b>{player.clueSubmitted ? "已提交" : "等待作答"}</b></span>)}</div>
            <div className="search-row pk-search-row"><div className="search-box"><svg className="search-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false"><circle cx="10.5" cy="10.5" r="6.25" /><path d="m15.25 15.25 4.5 4.5" /></svg><input value={query} disabled={Boolean(me?.clueSubmitted)} onChange={(event) => { setQuery(event.target.value); setSelectedBvid(null); }} onKeyDown={onSearchKeyDown} placeholder="输入作品名或拼音搜索…" aria-label="搜索线索阶梯作品" autoComplete="off" />{query && !me?.clueSubmitted && <div className="suggestions" role="listbox">{matches.length ? matches.map((song) => <button type="button" role="option" aria-selected={selectedBvid === song.bvid} key={song.bvid} onClick={() => { setSelectedBvid(song.bvid); setQuery(song.name); }}><span>{song.name}</span><small>{song.vocalists.join("、")} · {song.publicationDate.slice(0, 4)}</small></button>) : <p className="no-match">没有找到符合的作品</p>}</div>}</div><button className="guess-button" type="button" disabled={!selectedBvid || guessPending || Boolean(me?.clueSubmitted)} onClick={submitGuess}>{guessPending ? "提交中…" : "抢答"} <span>↵</span></button><button className="pk-skip-button" type="button" disabled={guessPending || Boolean(me?.clueSubmitted)} onClick={skipClue}>跳过</button></div>
            <p className="pk-clue-note">每层只能猜一次或跳过一次；提交内容会在本层结束后一起揭晓。</p>
            {clueActions.length > 0 && <div className="pk-clue-history"><h3>我的操作</h3>{[...clueActions].reverse().map((action) => <div key={`${action.stage}-${action.type}`}><span>第 {action.stage} 层</span><strong>{action.type === "skip" ? "跳过" : action.name ?? "已提交"}</strong></div>)}</div>}
          </div> : <>
            <div className="search-row pk-search-row"><div className="search-box"><svg className="search-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false"><circle cx="10.5" cy="10.5" r="6.25" /><path d="m15.25 15.25 4.5 4.5" /></svg><input value={query} onChange={(event) => { setQuery(event.target.value); setSelectedBvid(null); }} onKeyDown={onSearchKeyDown} placeholder="输入作品名或拼音搜索…" aria-label="搜索多人模式作品" autoComplete="off" />{query && <div className="suggestions" role="listbox">{matches.length ? matches.map((song) => <button type="button" role="option" aria-selected={selectedBvid === song.bvid} key={song.bvid} onClick={() => { setSelectedBvid(song.bvid); setQuery(song.name); }}><span>{song.name}</span><small>{song.vocalists.join("、")} · {song.publicationDate.slice(0, 4)}</small></button>) : <p className="no-match">没有找到符合的作品</p>}</div>}</div><button className="guess-button" type="button" disabled={!selectedBvid || guessPending || (me?.attempts ?? 0) >= room.maxGuesses} onClick={submitGuess}>{guessPending ? "提交中…" : "猜一下"} <span>↵</span></button></div>
            <div className="legend"><span><i className="correct" />完全一致</span><span><i className="partial" />部分一致</span><span><i className="wrong" />不一致</span><span className="legend-hint">箭头指向正确答案</span></div>
            <div className="guess-board pk-guess-board"><div className="board-head">{LABELS.map((label) => <span key={label}>{label}</span>)}</div>{[...rows].reverse().map((row, index) => <div className="guess-grid" key={`${row.bvid}-${row.attempt}`} style={{ "--delay": `${index * 45}ms` } as CSSProperties}>{row.cells.map((cell, cellIndex) => <div className={`result-cell ${cell.tone}`} key={`${row.bvid}-${cellIndex}`}><small className="cell-label">{LABELS[cellIndex]}</small><strong>{cell.text || "无"}</strong>{cell.hint && <span className="direction">{cell.hint}</span>}</div>)}</div>)}{!rows.length && <div className="empty-state"><span className="vinyl">♫</span><strong>第一条线索，等你来猜</strong><p>这次要和朋友比速度。</p></div>}</div>
          </>}
        </section>
      )}

      {screen === "ended" && room && answer && (
        <section className={`pk-card pk-result-card ${isPlayerWinner ? "won" : ""}`}>
          {isPlayerWinner && <div className="pk-result-victory" role="status"><span>✓</span><strong>{victoryMessage}</strong></div>}
          <h2>{outcome}</h2>
          <p className="pk-result-subtitle">{resultSubtitle}</p>
          <div className="pk-answer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={answer.coverUrl} alt={`${answer.name} 封面`} referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = "/og.png"; }} />
            <div><small>本局答案</small>{extendedOnlyAnswer && <small className="extended-badge">✦ 扩展题</small>}<strong>{answer.name}</strong><span>{answer.vocalists.join("、")} · {formatDate(answer.publicationDate)}</span><div className="answer-chips"><span>{formatTier(answer.viewTier)}</span><span>{answer.views === null ? formatViews(answer.views) : `${formatViews(answer.views)}播放`}</span><span>{countTitleCharacters(answer.name)}字歌名</span></div></div>
          </div>
          <div className="pk-final-score">{resultPlayers.map((player) => <div key={player.id} className={resultWinnerIds.includes(player.id) ? "winner" : ""}><span>{player.name}{player.left || player.forfeited ? "（已弃权）" : player.id === playerId ? "（你）" : ""}</span><strong>{player.attempts} 次{resultWinnerIds.includes(player.id) ? " · 胜者" : ""}</strong></div>)}</div>
          <div className="pk-round-recap"><h3>{activeGameType === "clues" ? "每层操作" : "本轮猜测"}</h3><div className="pk-round-recap-grid">{resultPlayers.map((player) => <section key={player.id}><header><strong>{player.name}{player.left || player.forfeited ? "（已弃权）" : player.id === playerId ? "（你）" : ""}</strong><span>{activeGameType === "clues" ? (player.clueActions?.length ?? 0) : (player.guesses?.length ?? 0)} 次</span></header>{activeGameType === "clues" ? (player.clueActions?.length ? <ol>{player.clueActions.map((action, index) => <li className={action.correct ? "correct" : ""} key={`${player.id}-${action.stage}-${index}`}><span>第{action.stage}层</span><strong>{action.type === "skip" ? "跳过" : action.name ?? "未知作品"}</strong>{action.correct && <em>猜中</em>}</li>)}</ol> : <p>本轮未操作</p>) : (player.guesses?.length ? <ol>{player.guesses.map((guess, index) => <li className={guess.correct ? "correct" : ""} key={`${player.id}-${guess.bvid}`}><span>{index + 1}</span><strong>{guess.name}</strong>{guess.correct && <em>猜中</em>}</li>)}</ol> : <p>本轮未猜</p>)}</section>)}</div></div>
          <div className="pk-result-actions"><button className="pk-share-button" type="button" onClick={shareResult}>生成本局战绩图</button>{me?.isHost ? <button className="pk-ready-button" type="button" disabled={leavingRoom} onClick={() => send("round:lobby")}>返回房间并准备</button> : <button className="pk-ready-button" type="button" disabled={leavingRoom} onClick={() => send("round:next-ready", { ready: !me?.nextReady })}>{me?.nextReady ? "已准备，等待房主" : "返回房间并准备"}</button>}</div>
          <button className="pk-text-button" type="button" onClick={leaveRoom}>退出房间</button>
        </section>
      )}

      {showPkGuide && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && dismissPkGuide()}><section className="modal pk-guide-modal" role="dialog" aria-modal="true" aria-labelledby="pk-guide-title"><button className="modal-close" type="button" onClick={dismissPkGuide} aria-label="关闭">×</button><h2 id="pk-guide-title">第一次玩？照着这几步来</h2><p>和朋友进入同一个房间，大家准备好后就开始。经典推理先猜中者赢；线索阶梯同一层猜中的玩家并列获胜。</p><div className="pk-guide-grid"><div><strong>先填昵称</strong><span>输入一个昵称，再创建房间或加入朋友的房间。</span></div><div><strong>创建或加入</strong><span>可以去公开大厅找房间，也可以输入房间码加入；进入房间后由房主选择玩法和题库。</span></div><div><strong>准备开始</strong><span>所有人点“准备”，房主再点“开始游戏”。</span></div><div><strong>经典推理</strong><span>输入歌名并提交，比较六项提示，先猜中者获胜。</span></div><div><strong>线索阶梯</strong><span>每层可以猜一次或跳过一次，20 秒后自动进入下一层。</span></div><div><strong>再来一局</strong><span>结束后点“返回房间并准备”，等大家准备好再开下一局。</span></div></div><h3>经典推理难度</h3><ul><li><b>普通模式</b>：6 次机会。</li><li><b>困难模式</b>：4 次机会。</li><li><b>线索阶梯</b>：固定 6 层，不显示难度选项。</li></ul><p className="fine-print">多人模式不开放观战。</p><button className="onboarding-start" type="button" onClick={dismissPkGuide}>知道了，开始游戏</button></section></div>}

      {shareCard && <ShareImageDialog model={shareCard} onClose={() => setShareCard(null)} />}

      {showPkRules && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowPkRules(false)}><section className="modal rules-modal pk-rules-modal" role="dialog" aria-modal="true" aria-labelledby="pk-rules-title" aria-describedby="pk-rules-summary"><button className="modal-close" type="button" onClick={() => setShowPkRules(false)} aria-label="关闭">×</button><h2 id="pk-rules-title">收录与判定规则</h2><p id="pk-rules-summary">输入一首 ilem 作品。提交后，各项线索会与答案比较；绿色为一致，黄色为部分重合。</p><div className="rule-samples"><span className="correct">完全一致</span><span className="partial">歌手、引擎部分重合，或投稿年份相同</span><span className="wrong">不一致；箭头指向正确答案</span></div><h3>收录与统计口径</h3><ul><li><b>标准题库</b>收录 ilem Bilibili 视频投稿中的音乐作品。</li><li><b>扩展题库</b>在标准题库基础上，补充了ilem/onyk作为staff参与的原创作品和被删除的作品。(不包含翻唱和remix)</li><li>播放量为定期更新的精确数字快照，不是实时数据。</li><li>纯音乐的演唱与引擎均记为“无”。</li><li>投稿日期年月日完全一致为绿色；年份相同但月日不同为黄色。</li></ul><h3>多人玩法</h3><ul className="rules-mode-list"><li><b>经典推理</b>显示六项线索；普通模式 6 次机会，困难模式 4 次机会。</li><li><b>线索阶梯</b>固定 6 层，依次揭示引擎、播放等级、演唱、投稿年份和歌名字数，最后一层不再增加线索。</li><li>每层只能猜一次或跳过一次；同层猜中的玩家并列获胜，本层无人猜中则进入下一层。</li><li>玩法和题库由房主在房间内选择，修改后所有人需要重新准备。</li></ul><h3>歌名字数</h3><p className="rules-copy">按网页中的作品名计算，忽略空格；<br className="rules-copy-break" />中文、英文、数字和标点各算一个字符。</p><h3>播放等级</h3><ul><li><b>普通</b>：低于 10 万（扩展题库）</li><li><b>殿堂</b>：10万—50万</li><li><b>专兑</b>：50万—100万</li><li><b>传说</b>：100万—1000万</li><li><b>神话</b>：1000万以上</li></ul><p className="fine-print">每轮题袋抽完前不会重复；房间可在刷新后自动重连，服务更新后可能需要刷新页面重新开始。</p></section></div>}

      {showPkStats && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowPkStats(false)}><section className="modal pk-stats-modal" role="dialog" aria-modal="true" aria-labelledby="pk-stats-title"><button className="modal-close" type="button" onClick={() => setShowPkStats(false)} aria-label="关闭">×</button><h2 id="pk-stats-title">本机多人模式战绩</h2><div className="stats-mode-tabs" role="tablist" aria-label="多人模式玩法"><button type="button" role="tab" aria-selected={statsGameType === "classic"} className={statsGameType === "classic" ? "active" : ""} onClick={() => setStatsGameType("classic")}>经典推理</button><button type="button" role="tab" aria-selected={statsGameType === "clues"} className={statsGameType === "clues" ? "active" : ""} onClick={() => setStatsGameType("clues")}>线索阶梯</button></div><div className="stats-mode-tabs pk-stats-pool-tabs" role="tablist" aria-label="多人模式战绩题库">{(["normal", "hardcore"] as CatalogPool[]).map((pool) => <button type="button" role="tab" aria-selected={statsPool === pool} className={statsPool === pool ? "active" : ""} onClick={() => setStatsPool(pool)} key={pool}><span>{POOL_RULES[pool].label}</span><small>{(statsGameType === "clues" ? pkStats.pools[pool].clues : pkStats.pools[pool].modes[statsMode]).played} 局</small></button>)}</div>{statsGameType === "classic" && <div className="stats-mode-tabs" role="tablist" aria-label="多人模式战绩难度">{(["normal", "hard"] as GameMode[]).map((mode) => <button type="button" role="tab" aria-selected={statsMode === mode} className={statsMode === mode ? "active" : ""} onClick={() => setStatsMode(mode)} key={mode}><span>{MODE_RULES[mode].label}</span><small>{pkStats.pools[statsPool].modes[mode].played} 局</small></button>)}</div>}<div className="stats-grid pk-stats-grid"><div><strong>{activePkStats.played}</strong><span>对局</span></div><div><strong>{pkWinRate}%</strong><span>胜率</span></div><div><strong>{activePkStats.streak}</strong><span>连胜</span></div><div><strong>{averageGuesses}</strong><span>平均猜测</span></div></div><div className="pk-stats-breakdown"><span>胜 <b>{activePkStats.wins}</b></span><span>负 <b>{activePkStats.losses}</b></span><span>平 <b>{activePkStats.draws}</b></span><span>最佳连胜 <b>{activePkStats.bestStreak}</b></span></div><h3>猜中次数分布</h3><div className="distribution">{activePkStats.distribution.map((count, index) => { const max = Math.max(...activePkStats.distribution, 1); return <div key={index}><span>{index + 1}</span><i style={{ width: `${Math.max(8, count / max * 100)}%` }}>{count}</i></div>; })}</div><button className="reset-button" type="button" onClick={resetPkStats}>清除本机多人战绩</button><p className="fine-print">多人模式战绩只保存在当前浏览器中。</p></section></div>}

      <footer className="pk-footer">
        <div className="footer-meta">
          <span>多人模式 · {GAME_TYPE_RULES[activeGameType].label} · 2–8 人</span>
          <span>题库：{activePoolRules.label} · 播放量快照：{activeCatalog.viewsSnapshotDate ?? "—"}</span>
          <span className="credits">
            如果对这个项目有什么意见或者数据有误联系<a href="https://space.bilibili.com/477277447/" target="_blank" rel="noreferrer">叁忆玖</a>。记得支持i12喵，关注<a href="https://space.bilibili.com/372295491" target="_blank" rel="noreferrer">站宝</a>喵，关注<a href="https://space.bilibili.com/372295491" target="_blank" rel="noreferrer">站宝</a>谢谢喵！ · 感谢<a href="https://space.bilibili.com/3493105640671353" target="_blank" rel="noreferrer">元应如是</a>提供了数据支持 · 感谢一个坑提供了域名解析帮助
          </span>
        </div>
        <div className="pk-footer-actions">
          <button className="pk-rules-link" type="button" onClick={() => setShowPkRules(true)}>收录与判定规则</button>
        </div>
      </footer>
    </main>
  );
}
