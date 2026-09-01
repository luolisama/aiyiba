"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import searchSongsJson from "../data/search-songs.json";
import songPinyinJson from "../data/song-pinyin.json";
import hardcoreSearchSongsJson from "../data/hardcore-search-songs.json";
import hardcoreSongPinyinJson from "../data/hardcore-song-pinyin.json";
import songsJson from "../data/songs.json";
import hardcoreSongsJson from "../data/hardcore-songs.json";
import ShareImageDialog from "../share-image-dialog";
import type { ShareCardModel } from "../share-card";
import { isExtendedOnlySong } from "../catalog-logic.mjs";
import { buildSingleShareCardModel } from "../share-card-model.mjs";
import CatalogSelector from "../catalog-selector";
import { GameTopBar } from "../cyber-nav";
import { trackGameEvent } from "../analytics-client";
import {
  addModeResult,
  countTitleCharacters,
  getMaxGuesses,
  matchesSongQuery,
  newestFirst,
  normalizeModeStats,
  normalizeSearchText,
} from "../game-logic.mjs";
import {
  createClassicRound,
  guessClassic,
  readLocalShoe,
  restoreClassicRound,
  surrenderClassic,
} from "../local-game-engine.mjs";

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
  viewTier: "普通曲" | "殿堂曲" | "专兑曲" | "传说曲" | "神话曲";
  coverUrl: string;
  bilibiliUrl: string;
};
type SongCatalog = {
  schemaVersion: number;
  generatedAt: string;
  viewsSnapshotDate: string;
  itemCount: number;
  items: Song[];
};
type SearchSong = Pick<Song, "bvid" | "name" | "publicationDate" | "vocalists"> & {
  searchAliases?: string[];
  searchPinyin?: string[];
};
type Tone = "correct" | "partial" | "wrong";
type CellResult = { tone: Tone; text: string; hint?: string };
type FinishReason = "guessed" | "attempts" | "surrender" | null;
type GameMode = "normal" | "hard";
type PoolName = "normal" | "hardcore";
type GuessRow = {
  bvid: string;
  attempt: number;
  correct: boolean;
  cells: CellResult[];
};
type GameState = {
  schemaVersion: 5;
  roundId: string;
  pool: PoolName;
  mode: GameMode;
  maxGuesses: number;
  answerBvid: string;
  guessBvids: string[];
  guesses: GuessRow[];
  finished: boolean;
  won: boolean;
  statsRecorded: boolean;
  finishReason: FinishReason;
  poolProgress: number;
  poolSize: number;
  answer?: Song;
};
type Stats = {
  played: number;
  wins: number;
  streak: number;
  bestStreak: number;
  distribution: number[];
};
type StatsByMode = Record<GameMode, Stats>;
type PoolStorage = {
  gameKey: string;
  shoeKey: string;
  legacyGameKeys: string[];
  statsKey: string;
  legacyStatsKeys: string[];
  rulesKey: string;
  legacyRulesKeys: string[];
};
type SongPool = {
  catalog: SongCatalog;
  songs: Song[];
  storage: PoolStorage;
};

function createPool(
  searchCatalog: { itemCount: number; items: SearchSong[] },
  pinyinByBvid: Record<string, string>,
  catalog: SongCatalog,
  storage: PoolStorage,
): SongPool {
  const fullByBvid = new Map(catalog.items.map((song) => [song.bvid, song]));
  const songs = searchCatalog.items.map((song) => ({
    ...fullByBvid.get(song.bvid),
    ...song,
    searchPinyin: [pinyinByBvid[song.bvid]].filter(Boolean),
  })) as Song[];
  return { catalog, songs, storage };
}

const NORMAL_POOL = createPool(
  searchSongsJson as SongCatalog,
  songPinyinJson as Record<string, string>,
  songsJson as SongCatalog,
  {
    gameKey: "aiyiba-game-v4",
    shoeKey: "aiyiba-solo-shoe-v3-normal",
    legacyGameKeys: ["aiyiba-game-v3", "aiyiba-game-v2", "aiyiba-game-v1"],
    statsKey: "aiyiba-stats-v2",
    legacyStatsKeys: ["aiyiba-stats-v1"],
    rulesKey: "aiyiba-rules-seen-v1",
    legacyRulesKeys: [],
  },
);
const HARDCORE_POOL = createPool(
  hardcoreSearchSongsJson as SongCatalog,
  hardcoreSongPinyinJson as Record<string, string>,
  hardcoreSongsJson as SongCatalog,
  {
    gameKey: "aiyiba-hardcore-game-v2",
    shoeKey: "aiyiba-solo-shoe-v3-hardcore",
    legacyGameKeys: ["aiyiba-hardcore-game-v1"],
    statsKey: "aiyiba-hardcore-stats-v1",
    legacyStatsKeys: [],
    // The first-use guide belongs to the game, rather than to a specific catalog.
    // Keep the old storage keys for rounds and stats so existing extended-catalog
    // records remain isolated from the standard catalog.
    rulesKey: "aiyiba-rules-seen-v1",
    legacyRulesKeys: ["aiyiba-hardcore-rules-seen-v1"],
  },
);
const STANDARD_BVIDS = new Set(NORMAL_POOL.songs.map((song) => song.bvid));
const DEFAULT_STATS = normalizeModeStats() as StatsByMode;
const CONFETTI_COLORS = ["#e14a42", "#f2b84b", "#2c9a78", "#4c72d9", "#d76ca7", "#fff4cf"];
const CONFETTI_PIECES = Array.from({ length: 56 }, (_, index) => {
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
    color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
  };
});

function writeLocalStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The game remains playable when browser storage is unavailable or full.
  }
}

function removeLocalStorage(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage failures; they should not interrupt a round.
  }
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function formatViews(value: number | null) {
  if (value === null) return "播放量待核";
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 1_000_000 ? 0 : 1)}万`;
  return value.toLocaleString("zh-CN");
}

function formatTier(value: Song["viewTier"]) {
  return value.replace(/曲$/u, "");
}

function loadStats(statsKey: string, legacyStatsKeys: string[]): StatsByMode {
  try {
    const raw = localStorage.getItem(statsKey);
    const legacyRaw = legacyStatsKeys.map((key) => localStorage.getItem(key)).find(Boolean);
    const normalized = normalizeModeStats(
      raw ? JSON.parse(raw) : null,
      legacyRaw ? JSON.parse(legacyRaw) : null,
    ) as StatsByMode;
    localStorage.setItem(statsKey, JSON.stringify(normalized));
    if (legacyRaw) legacyStatsKeys.forEach(removeLocalStorage);
    return normalized;
  } catch {
    return normalizeModeStats() as StatsByMode;
  }
}

function hasSeenRules(storage: PoolStorage) {
  try {
    if (localStorage.getItem(storage.rulesKey) === "seen") return true;
    const legacySeen = storage.legacyRulesKeys.some((key) => localStorage.getItem(key) === "seen");
    if (!legacySeen) return false;
    localStorage.setItem(storage.rulesKey, "seen");
    storage.legacyRulesKeys.forEach(removeLocalStorage);
    return true;
  } catch {
    return false;
  }
}

function persistStoredGame(key: string, value: GameState) {
  const safeValue: Record<string, unknown> = { ...value };
  delete safeValue.answer;
  delete safeValue.guesses;
  writeLocalStorage(key, JSON.stringify(safeValue));
}

function poolFromLocation(): PoolName {
  if (typeof window === "undefined") return "normal";
  const catalog = new URLSearchParams(window.location.search).get("catalog");
  return catalog === "extended" || catalog === "hardcore" ? "hardcore" : "normal";
}

function poolFor(poolName: PoolName) {
  return poolName === "hardcore" ? HARDCORE_POOL : NORMAL_POOL;
}

function poolLabel(poolName: PoolName) {
  return poolName === "hardcore" ? "扩展题库" : "标准题库";
}

function replaceCatalogInUrl(poolName: PoolName) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (poolName === "hardcore") url.searchParams.set("catalog", "extended");
  else url.searchParams.delete("catalog");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function SinglePlayerPage() {
  const [poolName, setPoolName] = useState<PoolName>(poolFromLocation);
  const pool = poolFor(poolName);
  const { catalog, songs, storage } = pool;
  const isExtendedCatalog = poolName === "hardcore";
  const [hydrated, setHydrated] = useState(false);
  const [game, setGame] = useState<GameState | null>(null);
  const [stats, setStats] = useState<StatsByMode>(DEFAULT_STATS);
  const [statsMode, setStatsMode] = useState<GameMode>("normal");
  const [query, setQuery] = useState("");
  const [selectedBvid, setSelectedBvid] = useState<string | null>(null);
  const [activeOption, setActiveOption] = useState(0);
  const [showRules, setShowRules] = useState(false);
  const [isFirstVisitGuide, setIsFirstVisitGuide] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [showSurrender, setShowSurrender] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [shareCard, setShareCard] = useState<ShareCardModel | null>(null);
  const [toast, setToast] = useState("");
  const [loadError, setLoadError] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const celebrationTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      void (() => {
        const requestedRules = new URLSearchParams(window.location.search).get("rules") === "1";
        if (requestedRules) {
          window.location.replace("/#rules-modal");
          return;
        }
        let restoredStats = loadStats(storage.statsKey, storage.legacyStatsKeys);
        if (cancelled) return;
        setStats(restoredStats);
        let storedMode: GameMode = "normal";
        let stored: Partial<GameState> | null = null;
        try {
          const raw = [storage.gameKey, ...storage.legacyGameKeys]
            .map((key) => localStorage.getItem(key))
            .find(Boolean);
          stored = raw ? JSON.parse(raw) as Partial<GameState> : null;
          storedMode = stored?.mode === "hard" ? "hard" : "normal";
        } catch {
          stored = null;
        }
        const restored = restoreClassicRound(stored, songs, poolName);
        let state: GameState;
        if (restored) {
          state = restored as GameState;
        } else {
          let savedShoe: string | null = null;
          try { savedShoe = localStorage.getItem(storage.shoeKey); } catch { /* storage is optional */ }
          const created = createClassicRound({
            pool: poolName,
            mode: storedMode,
            songs,
            shoe: readLocalShoe(savedShoe, songs.map((song) => song.bvid)),
          });
          writeLocalStorage(storage.shoeKey, JSON.stringify(created.shoe));
          state = created.state as GameState;
        }
        if (cancelled) return;
        if (stored && stored.schemaVersion !== 5) {
          setToast("玩法已更新，旧本局无法恢复，已重新抽取题目");
          window.setTimeout(() => setToast(""), 2800);
        }
        if (state.finished && !state.statsRecorded) {
          restoredStats = addModeResult(
            restoredStats,
            state.mode,
            state.won,
            state.guesses.length,
            state.maxGuesses,
          ) as StatsByMode;
          writeLocalStorage(storage.statsKey, JSON.stringify(restoredStats));
          setStats(restoredStats);
          state.statsRecorded = true;
        }
        persistStoredGame(storage.gameKey, state);
        storage.legacyGameKeys.forEach(removeLocalStorage);
        setGame(state);
        setShowResult(state.finished);
        setLoadError("");
        setHydrated(true);

        try {
          const firstVisit = !hasSeenRules(storage);
          if (firstVisit) {
            setIsFirstVisitGuide(true);
            setShowRules(true);
          }
        } catch {
          setIsFirstVisitGuide(true);
          setShowRules(true);
        }
      })();
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [poolName, storage, songs]);

  useEffect(() => () => {
    if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current);
  }, []);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) setSelectedBvid(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const answer = game?.answer;
  const guesses = useMemo(() => game?.guesses ?? [], [game?.guesses]);
  const displayedGuesses = newestFirst(guesses) as GuessRow[];
  const isHardMode = game?.mode === "hard";
  const maxGuesses = game?.maxGuesses ?? getMaxGuesses(game?.mode);
  const modeLocked = guesses.length > 0 || Boolean(game?.finished);
  const guessedSet = useMemo(() => new Set(guesses.map((guess) => guess.bvid)), [guesses]);
  const normalizedQuery = normalizeSearchText(query);
  const queryWasGuessed = Boolean(normalizedQuery && guesses.some(
    (guess) => {
      const song = songs.find((candidate) => candidate.bvid === guess.bvid);
      return song ? matchesSongQuery(song, normalizedQuery, true) : false;
    },
  ));
  const matches = useMemo(() => {
    const needle = normalizeSearchText(query);
    if (!needle) return [];
    const activeSongs = poolName === "hardcore" ? HARDCORE_POOL.songs : NORMAL_POOL.songs;
    return activeSongs.filter(
      (song) =>
        !guessedSet.has(song.bvid) &&
        matchesSongQuery(song, needle),
    ).slice(0, 8);
  }, [query, guessedSet, poolName]);

  function persistGame(next: GameState, targetStorage = storage) {
    setGame(next);
    persistStoredGame(targetStorage.gameKey, next);
  }

  function startLocalRound(mode: GameMode, targetPool = poolName) {
    if (requestBusy) return;
    setRequestBusy(true);
    try {
      const target = poolFor(targetPool);
      const allBvids = target.songs.map((song) => song.bvid);
      let savedShoe: string | null = null;
      try { savedShoe = localStorage.getItem(target.storage.shoeKey); } catch { /* storage is optional */ }
      const created = createClassicRound({
        pool: targetPool,
        mode,
        songs: target.songs,
        shoe: readLocalShoe(savedShoe, allBvids),
      });
      writeLocalStorage(target.storage.shoeKey, JSON.stringify(created.shoe));
      const next = { ...created.state, statsRecorded: false } as GameState;
      persistGame(next, target.storage);
      if (targetPool !== poolName) {
        setPoolName(targetPool);
        setStats(loadStats(target.storage.statsKey, target.storage.legacyStatsKeys));
        replaceCatalogInUrl(targetPool);
      }
      setShowResult(false);
      setShowSurrender(false);
      setLoadError("");
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "暂时无法开始新一局");
      return false;
    } finally {
      setRequestBusy(false);
    }
  }

  function changeMode(mode: GameMode) {
    if (!game || modeLocked) return;
    startLocalRound(mode);
  }

  function changeCatalog(targetPool: PoolName) {
    if (!game || modeLocked || requestBusy || targetPool === poolName) return;
    setQuery("");
    setSelectedBvid(null);
    setActiveOption(0);
    void (async () => {
      const changed = startLocalRound(game.mode, targetPool);
      if (!changed) return;
      setToast(`已切换至${poolLabel(targetPool)}，本局题目已重新抽取`);
      window.setTimeout(() => setToast(""), 2600);
    })();
  }

  function recordResult(won: boolean, attempts: number, mode: GameMode) {
    const next = addModeResult(loadStats(storage.statsKey, storage.legacyStatsKeys), mode, won, attempts, getMaxGuesses(mode)) as StatsByMode;
    writeLocalStorage(storage.statsKey, JSON.stringify(next));
    setStats(next);
  }

  function makeGuess(bvid: string) {
    if (!game || game.finished || guessedSet.has(bvid) || requestBusy) return;
    setRequestBusy(true);
    try {
      const guessed = guessClassic(game, songs, bvid);
      const next = { ...guessed, statsRecorded: guessed.finished } as GameState;
      persistGame(next);
      if (game.guesses.length === 0) {
        trackGameEvent({ event: "game_engaged", roundId: game.roundId, mode: "solo_classic", pool: game.pool, difficulty: game.mode });
      }
      setLoadError("");
      if (next.finished) {
        trackGameEvent({
          event: "game_completed",
          roundId: next.roundId,
          mode: "solo_classic",
          pool: next.pool,
          difficulty: next.mode,
          outcome: next.won ? "win" : next.finishReason === "surrender" ? "surrender" : "loss",
          attempts: next.guesses.length,
        });
        if (!game.statsRecorded) recordResult(next.won, next.guesses.length, next.mode);
        if (next.won) {
          setShowCelebration(true);
          if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current);
          celebrationTimerRef.current = window.setTimeout(() => setShowCelebration(false), 2900);
        }
        window.setTimeout(() => setShowResult(true), 450);
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "提交失败，请稍后再试");
    } finally {
      setRequestBusy(false);
    }
    setQuery("");
    setSelectedBvid(null);
    setActiveOption(0);
  }

  function surrenderRound() {
    if (!game || game.finished || requestBusy) return;
    setRequestBusy(true);
    try {
      const next = { ...surrenderClassic(game, songs), statsRecorded: true } as GameState;
      persistGame(next);
      if (game.guesses.length === 0) {
        trackGameEvent({ event: "game_engaged", roundId: game.roundId, mode: "solo_classic", pool: game.pool, difficulty: game.mode });
      }
      trackGameEvent({
        event: "game_completed",
        roundId: next.roundId,
        mode: "solo_classic",
        pool: next.pool,
        difficulty: next.mode,
        outcome: "surrender",
        attempts: next.guesses.length,
      });
      if (!game.statsRecorded) recordResult(false, next.guesses.length, next.mode);
      setShowSurrender(false);
      setShowResult(true);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "暂时无法查看答案");
    } finally {
      setRequestBusy(false);
    }
  }

  function startNewGame() {
    if (!game || requestBusy) return;
    setQuery("");
    setSelectedBvid(null);
    setActiveOption(0);
    setShowCelebration(false);
    if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current);
    setShowResult(false);
    setShowSurrender(false);
    if (startLocalRound(game.mode)) {
      trackGameEvent({ event: "replay_requested", roundId: game.roundId, mode: "solo_classic", pool: game.pool, difficulty: game.mode });
    }
  }

  function resetLocalRecord() {
    if (!game || !window.confirm(`清除${poolLabel(poolName)}的本机战绩和抽题历史？当前这一局会保留。`)) return;
    removeLocalStorage(storage.statsKey);
    storage.legacyStatsKeys.forEach(removeLocalStorage);
    removeLocalStorage(storage.shoeKey);
    removeLocalStorage(poolName === "hardcore" ? "aiyiba-hardcore-shoe-v1" : "aiyiba-shoe-v2");
    setStats(normalizeModeStats() as StatsByMode);
    setShowStats(false);
    setToast("本机记录已清除");
    window.setTimeout(() => setToast(""), 2200);
  }

  function openRules() {
    setIsFirstVisitGuide(false);
    setShowRules(true);
  }

  const dismissRules = useCallback(() => {
    try {
      localStorage.setItem("aiyiba-rules-seen-v1", "seen");
    } catch {
      // The guide can still be dismissed when browser storage is unavailable.
    }
    setShowRules(false);
    setIsFirstVisitGuide(false);
  }, []);

  function shareResult() {
    if (!game || !answer) return;
    const modeLabel = game.mode === "hard" ? "困难模式" : "普通模式";
    setShareCard(buildSingleShareCardModel({
      poolLabel: poolLabel(game.pool),
      modeLabel,
      won: game.won,
      finishReason: game.finishReason,
      maxGuesses: game.maxGuesses,
      answer,
      guesses,
      siteOrigin: window.location.origin,
    }) as ShareCardModel);
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setQuery("");
      setSelectedBvid(null);
      return;
    }
    if (!matches.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveOption((value) => (value + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveOption((value) => (value - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = selectedBvid ?? matches[activeOption]?.bvid;
      if (target) makeGuess(target);
    }
  }

  const modalOpen = showRules || showStats || showSurrender || showResult;
  useEffect(() => {
    if (!modalOpen) return undefined;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => dialog
      ? [...dialog.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true")
      : [];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector(".share-image-modal")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (showRules) dismissRules();
        else if (showStats) setShowStats(false);
        else if (showSurrender) setShowSurrender(false);
        else setShowResult(false);
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
  }, [dismissRules, modalOpen, showRules, showStats, showSurrender, showResult]);

  if (!hydrated || !game || (game.finished && !answer)) {
    if (hydrated && loadError) {
      return (
        <main className="loading-screen">
          <div className="loading-mark">哎</div>
          <p>{loadError}</p>
          <button className="onboarding-start" type="button" onClick={() => window.location.reload()}>刷新后继续游玩</button>
        </main>
      );
    }
    return (
      <main className="loading-screen">
        <div className="loading-mark">哎</div>
        <p>正在抽取题目…</p>
      </main>
    );
  }

  const activeStats = stats[statsMode];
  const visibleDistribution = activeStats.distribution.slice(0, getMaxGuesses(statsMode));
  const winRate = activeStats.played ? Math.round((activeStats.wins / activeStats.played) * 100) : 0;
  const displayAnswer = answer as Song;
  const extendedOnlyAnswer = answer ? isExtendedOnlySong(poolName, answer.bvid, STANDARD_BVIDS) : false;
  const selected = selectedBvid ? songs.find((song) => song.bvid === selectedBvid) : undefined;
  const labels = ["作品", "演唱", "引擎", "歌名字数", "投稿日期", "播放等级"];
  const outcomeLabel = game.won ? "猜中了" : game.finishReason === "surrender" ? "已放弃" : "答案揭晓";

  return (
    <main className="site-shell">
      {showCelebration && (
        <div className="confetti-burst" aria-hidden="true">
          {CONFETTI_PIECES.map((piece) => (
            <i
              className="confetti-piece"
              key={piece.id}
              style={{
                "--x": `${piece.x}px`,
                "--y": `${piece.y}px`,
                "--end-x": `${piece.endX}px`,
                "--end-y": `${piece.endY}px`,
                "--rotation": `${piece.rotation}deg`,
                "--delay": `${piece.delay}s`,
                "--confetti-color": piece.color,
              } as React.CSSProperties}
            />
          ))}
        </div>
      )}
      <GameTopBar activePath="/solo" catalog={poolName} modeLabel="经典推理">
          <button className="pk-entry-link" type="button" onClick={openRules}>说明</button>
          <button className="pk-entry-link" type="button" onClick={() => { setStatsMode(game.mode); setShowStats(true); }}>战绩</button>
      </GameTopBar>

      <section className="hero">
        <h1>听过很多遍，<br /><span>你真的认得它吗？</span></h1>
        <p className="intro">从{poolLabel(poolName)}的 {catalog.itemCount} 首作品中找出本局答案。每猜一次，线索就更近一点。</p>
        <div className={`round-meter ${game.finished ? "finished" : ""}`} aria-label={`已经猜了 ${guesses.length} 次，共 ${maxGuesses} 次机会`}>
          {Array.from({ length: maxGuesses }, (_, index) => (
            <span key={index} className={index < guesses.length ? "used" : !game.finished && index === guesses.length ? "current" : ""} />
          ))}
          {game.finished ? <><strong>{game.won ? "猜中" : "结束"}</strong><small>本局</small></> : <><strong>{maxGuesses - guesses.length}</strong><small>次机会</small></>}
        </div>
      </section>

      <section className="game-panel" aria-label="猜歌区域">
        <CatalogSelector
          pool={poolName}
          itemCount={catalog.itemCount}
          locked={modeLocked}
          busy={requestBusy}
          onChange={changeCatalog}
        />
        <div className="mode-bar">
          <div className="mode-copy">
            <strong>{isHardMode ? "困难模式" : "普通模式"}</strong>
            <span>{isHardMode ? "显示全部六项线索，4 次机会" : "显示全部六项线索，6 次机会"}</span>
          </div>
          <div className="mode-actions" role="group" aria-label="选择游戏模式">
            <button type="button" className={!isHardMode ? "active" : ""} aria-pressed={!isHardMode} disabled={modeLocked} onClick={() => changeMode("normal")}>普通</button>
            <button type="button" className={isHardMode ? "active" : ""} aria-pressed={isHardMode} disabled={modeLocked} onClick={() => changeMode("hard")}>困难</button>
            {modeLocked && <small>本局已锁定</small>}
          </div>
        </div>
        <div className="search-row" ref={searchRef}>
          <div className="search-box">
            <svg className="search-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false">
              <circle cx="10.5" cy="10.5" r="6.25" />
              <path d="m15.25 15.25 4.5 4.5" />
            </svg>
            <input
              value={query}
              disabled={game.finished}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedBvid(null);
                setActiveOption(0);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder={game.finished ? "本局已结束" : "输入作品名或拼音搜索…"}
              enterKeyHint="search"
              role="combobox"
              aria-label="搜索作品"
              aria-autocomplete="list"
              aria-controls="solo-suggestions"
              aria-expanded={Boolean(query && !game.finished)}
              aria-activedescendant={query && !game.finished && matches[activeOption]
                ? `solo-option-${matches[activeOption].bvid}`
                : undefined}
              autoComplete="off"
            />
            {query && !game.finished && (
              <div className="suggestions" role="listbox" id="solo-suggestions">
                {matches.length ? matches.map((song, index) => (
                  <button
                    type="button"
                    role="option"
                    id={`solo-option-${song.bvid}`}
                    aria-selected={selectedBvid === song.bvid}
                    className={index === activeOption ? "active" : ""}
                    key={song.bvid}
                    onMouseEnter={() => setActiveOption(index)}
                    onClick={() => {
                      setSelectedBvid(song.bvid);
                      setQuery(song.name);
                    }}
                  >
                    <span>{song.name}</span>
                    <small>{song.vocalists.join("、")} · {song.publicationDate.slice(0, 4)}</small>
                  </button>
                )) : <p className="no-match">{queryWasGuessed ? "这首已经猜过了" : "没有找到未猜过的作品"}</p>}
              </div>
            )}
          </div>
          <button
            className="guess-button"
            disabled={!selected || game.finished}
            onClick={() => selected && makeGuess(selected.bvid)}
          >
            猜一下 <span>↵</span>
          </button>
        </div>

        {!game.finished && (
          <div className="round-controls">
            <button className="surrender-button" onClick={() => setShowSurrender(true)}>看答案并放弃本局</button>
          </div>
        )}

        <div className="legend">
          <span><i className="correct" />完全一致</span>
          <span><i className="partial" />部分一致</span>
          <span><i className="wrong" />不一致</span>
          <span className="legend-hint">箭头指向正确答案</span>
        </div>

        <div className={`guess-board ${isHardMode ? "hard-mode" : "normal-mode"}`}>
          <div className="board-head">
            {labels.map((label) => <span key={label}>{label}</span>)}
          </div>
          {displayedGuesses.map((guess, rowIndex) => (
            <div className="guess-grid" key={guess.bvid} style={{ "--delay": `${rowIndex * 45}ms` } as React.CSSProperties}>
              {guess.cells.map((cell, cellIndex) => (
                <div className={`result-cell ${cell.tone}`} key={`${guess.bvid}-${labels[cellIndex]}`}>
                  <small className="cell-label">{labels[cellIndex]}</small>
                  <strong>{cell.text || "无"}</strong>
                  {cell.hint && <span className="direction">{cell.hint}</span>}
                </div>
              ))}
            </div>
          ))}
          {!guesses.length && !game.finished && (
            <div className="empty-state">
              <span className="vinyl">♫</span>
              <strong>第一条线索，等你来猜</strong>
              <p>颜色会告诉你每项信息离答案有多近。</p>
            </div>
          )}
          {guesses.length > 0 && !game.finished && <div className="next-slot">第 {guesses.length + 1} 次猜测</div>}
        </div>

        {game.finished && (
          <section className="round-summary" aria-label="本局答案">
            <div>
              <p className="round-status">{outcomeLabel}</p>
              <h2>{displayAnswer.name}</h2>
              <p>{displayAnswer.vocalists.join("、")} · {displayAnswer.engines.join("、")} · {formatTier(displayAnswer.viewTier)}</p>
            </div>
            <div className="summary-actions">
              <button onClick={() => setShowResult(true)}>查看完整结果</button>
              <button className="primary" onClick={startNewGame}>再来一把 →</button>
            </div>
          </section>
        )}
      </section>

      <footer>
        <div className="footer-meta">
          <span>题库：{poolLabel(poolName)} · {catalog.itemCount} 首</span>
          <span>播放量快照：{catalog.viewsSnapshotDate}</span>
          <span className="credits">
            如果对这个项目有什么意见或者数据有误联系<a href="https://space.bilibili.com/477277447/" target="_blank" rel="noreferrer">叁忆玖</a>。记得支持i12喵，关注<a href="https://space.bilibili.com/372295491" target="_blank" rel="noreferrer">站宝</a>谢谢喵！ · 感谢<a href="https://space.bilibili.com/3493105640671353" target="_blank" rel="noreferrer">元应如是</a>提供了数据支持 · 感谢一个坑提供了域名解析帮助
          </span>
        </div>
        <button onClick={openRules}>收录与判定规则</button>
      </footer>

      {showRules && (
        <div className={`modal-backdrop ${isFirstVisitGuide ? "onboarding-backdrop" : ""}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && dismissRules()}>
          <section className="modal rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title" aria-describedby="rules-summary">
            <button className="modal-close" onClick={dismissRules} aria-label="关闭">×</button>
            <h2 id="rules-title">{isFirstVisitGuide ? "第一次玩？先了解玩法" : "选择模式，猜中作品"}</h2>
            <p id="rules-summary">输入一首 ilem 作品。提交后，各项线索会与答案比较；绿色为一致，黄色为部分重合。</p>
            <div className="rule-samples">
              <span className="correct">完全一致</span>
              <span className="partial">歌手、引擎部分重合，或投稿年份相同</span>
              <span className="wrong">不一致；箭头指向正确答案</span>
            </div>
            <h3>收录与统计口径</h3>
            <ul>
              <li><b>标准题库</b>收录 ilem Bilibili 视频投稿中的音乐作品。</li>
              <li><b>扩展题库</b>在标准题库基础上，补充了ilem/onyk作为staff参与的原创作品和被删除的作品。(不包含翻唱和remix)</li>
              <li>题库可在本局开始前，通过游戏面板顶部的“本局题库”切换。</li>
              <li>播放量为定期更新的精确数字快照，不是实时数据。</li>
              <li>纯音乐的演唱与引擎均记为“无”。</li>
              <li>投稿日期年月日完全一致为绿色；年份相同但月日不同为黄色。</li>
            </ul>
            <h3>普通与困难模式</h3>
            <ul className="rules-mode-list">
              <li><b>普通模式</b>显示全部六项线索，共有 6 次机会。</li>
              <li><b>困难模式</b>与普通模式显示相同的全部六项线索，但只有 4 次机会。</li>
              <li>模式可在首次提交前切换，开始猜测后本局锁定。</li>
            </ul>
            <h3>歌名字数</h3>
            <p className="rules-copy">按网页中的作品名计算，忽略空格；<br className="rules-copy-break" />中文、英文、数字和标点各算一个字符。</p>
            <h3>播放等级</h3>
            <ul>
              {isExtendedCatalog && <li><b>普通</b>：低于 10 万（扩展题库）</li>}
              <li><b>殿堂</b>：10万—50万</li>
              <li><b>专兑</b>：50万—100万</li>
              <li><b>传说</b>：100万—1000万</li>
              <li><b>神话</b>：1000万以上</li>
            </ul>
            <p className="fine-print">每轮题袋抽完前不会重复；战绩、题袋和进行中的对局均保存在当前浏览器。</p>
            {isFirstVisitGuide && (
              <>
                <button className="onboarding-start" onClick={dismissRules}>知道了，开始猜</button>
                <p className="rules-reminder">之后可以点击右上角的“?”重新查看</p>
              </>
            )}
          </section>
        </div>
      )}

      {showStats && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowStats(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="stats-title">
            <button className="modal-close" onClick={() => setShowStats(false)} aria-label="关闭">×</button>
            <h2 id="stats-title">{poolLabel(poolName)} · 本机战绩</h2>
            <div className="stats-mode-tabs" role="tablist" aria-label="战绩模式">
              <button type="button" role="tab" aria-selected={statsMode === "normal"} className={statsMode === "normal" ? "active" : ""} onClick={() => setStatsMode("normal")}>
                <span>普通模式</span><small>{stats.normal.played} 局</small>
              </button>
              <button type="button" role="tab" aria-selected={statsMode === "hard"} className={statsMode === "hard" ? "active" : ""} onClick={() => setStatsMode("hard")}>
                <span>困难模式</span><small>{stats.hard.played} 局</small>
              </button>
            </div>
            <div className="stats-grid">
              <div><strong>{activeStats.played}</strong><span>游玩</span></div>
              <div><strong>{winRate}%</strong><span>胜率</span></div>
              <div><strong>{activeStats.streak}</strong><span>连胜</span></div>
              <div><strong>{activeStats.bestStreak}</strong><span>最佳</span></div>
            </div>
            <h3>猜中次数分布</h3>
            <div className="distribution">
              {visibleDistribution.map((count, index) => {
                const max = Math.max(...visibleDistribution, 1);
                return <div key={index}><span>{index + 1}</span><i style={{ width: `${Math.max(8, count / max * 100)}%` }}>{count}</i></div>;
              })}
            </div>
            <p className="shoe-progress">本轮题袋已抽取 <b>{game.poolProgress}</b> / {game.poolSize} 首，用完前不会重复。</p>
            <button className="reset-button" onClick={resetLocalRecord}>清除本机战绩与抽题历史</button>
            <p className="fine-print">战绩、题目和进行中的对局均保存在当前浏览器。</p>
          </section>
        </div>
      )}

      {showSurrender && !game.finished && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowSurrender(false)}>
          <section className="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="surrender-title">
            <button className="modal-close" onClick={() => setShowSurrender(false)} aria-label="关闭">×</button>
            <h2 id="surrender-title">确定直接看答案？</h2>
            <p>这会结束当前对局，并在本机战绩中记为一次失败。</p>
            <div className="confirm-actions">
              <button onClick={() => setShowSurrender(false)}>继续猜</button>
              <button className="danger" onClick={surrenderRound}>放弃并看答案</button>
            </div>
          </section>
        </div>
      )}

      {showResult && game.finished && (
        <div className="modal-backdrop result-backdrop" role="presentation">
          <section className={`modal result-modal ${game.won ? "won" : ""}`} role="dialog" aria-modal={shareCard ? undefined : "true"} aria-hidden={shareCard ? "true" : undefined} inert={Boolean(shareCard) || undefined} aria-labelledby="result-title">
            <button className="modal-close" onClick={() => setShowResult(false)} aria-label="暂时关闭">×</button>
            <div className="answer-cover">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={displayAnswer.coverUrl}
                alt={`${displayAnswer.name} 的视频封面`}
                referrerPolicy="no-referrer"
                onError={(event) => {
                  event.currentTarget.onerror = null;
                  event.currentTarget.src = "/og.png";
                }}
              />
              {!game.won && <span>{outcomeLabel}</span>}
            </div>
            {game.won && (
              <div className="victory-banner" role="status">
                <span className="victory-check">✓</span>
                <div><strong>猜中了！</strong></div>
                <em>第 {guesses.length} 次命中</em>
              </div>
            )}
            {displayAnswer.gameRole === "easter_egg" && <p className="easter-badge">✦ 你遇到了彩蛋题</p>}
            {extendedOnlyAnswer && <p className="extended-badge">✦ 扩展题</p>}
            <h2 id="result-title">{displayAnswer.name}</h2>
            <p className="answer-meta">{displayAnswer.vocalists.join("、")} · {displayAnswer.engines.join("、")} · {formatDate(displayAnswer.publicationDate)}</p>
            <div className="answer-chips"><span>{formatTier(displayAnswer.viewTier)}</span><span>{displayAnswer.views === null ? formatViews(displayAnswer.views) : `${formatViews(displayAnswer.views)}播放`}</span><span>{countTitleCharacters(displayAnswer.name)}字歌名</span></div>
            <div className="result-actions">
              <a href={displayAnswer.bilibiliUrl} target="_blank" rel="noreferrer">去 B 站听 ↗</a>
              <button onClick={shareResult}>生成战绩图</button>
            </div>
            <button className="again-button" onClick={startNewGame}>再来一把 <span>→</span></button>
          </section>
        </div>
      )}

      {shareCard && <ShareImageDialog model={shareCard} onClose={() => setShareCard(null)} />}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

export default function Home() {
  return <SinglePlayerPage />;
}
