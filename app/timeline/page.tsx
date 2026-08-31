"use client";

import RulesDialog from "../rules-dialog";
import { useCallback, useEffect, useState } from "react";
import searchSongsJson from "../data/search-songs.json";
import hardcoreSearchSongsJson from "../data/hardcore-search-songs.json";
import songsJson from "../data/songs.json";
import hardcoreSongsJson from "../data/hardcore-songs.json";
import CatalogSelector from "../catalog-selector";
import { GameTopBar } from "../cyber-nav";
import { trackGameEvent } from "../analytics-client";
import {
  createTimelineRound,
  placeTimeline,
  restoreTimelineRound,
} from "../local-game-engine.mjs";
import {
  normalizeTimelineStats,
  recordTimelineResult,
  resetTimelinePoolStats,
} from "./client-logic.mjs";

type PoolName = "normal" | "hardcore";
const POOL_COUNTS: Record<PoolName, number> = {
  normal: searchSongsJson.itemCount,
  hardcore: hardcoreSearchSongsJson.itemCount,
};
type TimelineSong = {
  bvid: string;
  name: string;
  publicationDate: string;
  coverUrl: string;
  bilibiliUrl: string;
};
type TargetSong = { bvid: string; name: string };
type Placement = {
  turn: number;
  bvid: string;
  name: string;
  chosenSlot: number;
  correctSlotStart?: number;
  correctSlotEnd?: number;
  correct: boolean;
  publicationDate: string;
};
type PlacementResult = {
  correct: boolean;
  insertedSlot: number;
  earliestSlot: number;
  latestSlot: number;
  song: TimelineSong;
};
type TimelineState = {
  schemaVersion: number;
  roundId: string;
  pool: PoolName;
  targetBvids: string[];
  maxPlacements: number;
  placements: Placement[];
  score: number;
  timeline: TimelineSong[];
  target: TargetSong | null;
  finished: boolean;
  lastPlacement?: PlacementResult;
};
type TimelinePoolStats = {
  played: number;
  totalScore: number;
  bestScore: number;
  perfectRounds: number;
  distribution: number[];
};
type TimelineStats = {
  schemaVersion: number;
  pools: Record<PoolName, TimelinePoolStats>;
  recordedRoundIds: string[];
};

const GAME_STORAGE_KEY = "aiyiba-timeline-game-v1";
const LEGACY_LOCAL_GAME_STORAGE_KEY = "aiyiba-timeline-game-v2";
const LOCAL_GAME_STORAGE_KEYS: Record<PoolName, string> = {
  normal: "aiyiba-timeline-game-v3-normal",
  hardcore: "aiyiba-timeline-game-v3-hardcore",
};
const POOLS = {
  normal: songsJson.items,
  hardcore: hardcoreSongsJson.items,
} as const;
const RULES_STORAGE_KEY = "aiyiba-timeline-rules-seen-v1";
const STATS_STORAGE_KEY = "aiyiba-timeline-stats-v1";

function poolFromLocation(): PoolName {
  if (typeof window === "undefined") return "normal";
  const value = new URLSearchParams(window.location.search).get("catalog");
  return value === "extended" || value === "hardcore" ? "hardcore" : "normal";
}

function poolLabel(pool: PoolName) {
  return pool === "hardcore" ? "扩展题库" : "标准题库";
}

function updateCatalogUrl(pool: PoolName) {
  const url = new URL(window.location.href);
  if (pool === "hardcore") url.searchParams.set("catalog", "extended");
  else url.searchParams.delete("catalog");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

function writeGame(state: TimelineState) {
  try {
    const safe = {
      ...state,
      timeline: state.timeline.map((song) => song.bvid),
      target: null,
      lastPlacement: undefined,
    };
    localStorage.setItem(LOCAL_GAME_STORAGE_KEYS[state.pool], JSON.stringify(safe));
  }
  catch { /* storage is optional */ }
}

function readStats(): TimelineStats {
  try { return normalizeTimelineStats(JSON.parse(localStorage.getItem(STATS_STORAGE_KEY) ?? "null")) as TimelineStats; }
  catch { return normalizeTimelineStats() as TimelineStats; }
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function formatSlotRange(start?: number, end?: number) {
  if (!Number.isInteger(start)) return "正确位置未知";
  const first = (start as number) + 1;
  const last = Number.isInteger(end) ? (end as number) + 1 : first;
  return first === last ? `第 ${first} 个空位` : `第 ${first}–${last} 个空位`;
}

export default function TimelinePage() {
  const [pool, setPool] = useState<PoolName>(poolFromLocation);
  const [game, setGame] = useState<TimelineState | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState("");
  const [showRules, setShowRules] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<TimelineStats>(() => normalizeTimelineStats() as TimelineStats);

  const saveFinishedResult = useCallback((state: TimelineState) => {
    if (!state.finished) return;
    const next = recordTimelineResult(readStats(), {
      roundId: state.roundId,
      pool: state.pool,
      score: state.score,
    }) as TimelineStats;
    try { localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(next)); } catch { /* optional */ }
    setStats(next);
  }, []);

  const startRound = useCallback((targetPool: PoolName) => {
    setBusy(true);
    try {
      const state = createTimelineRound({ pool: targetPool, songs: POOLS[targetPool] }) as TimelineState;
      setPool(targetPool);
      setGame(state);
      writeGame(state);
      updateCatalogUrl(targetPool);
      setLoadError("");
      setToast("");
      return true;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "暂时无法开始时光机");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      void (() => {
        const requestedPool = poolFromLocation();
        const songs = POOLS[requestedPool];
        setStats(readStats());
        let stored: Partial<TimelineState> | null = null;
        let migratedLegacyKey: string | null = null;
        try {
          const current = localStorage.getItem(LOCAL_GAME_STORAGE_KEYS[requestedPool]);
          if (current) {
            stored = JSON.parse(current) as Partial<TimelineState>;
          } else {
            for (const key of [LEGACY_LOCAL_GAME_STORAGE_KEY, GAME_STORAGE_KEY]) {
              const legacy = localStorage.getItem(key);
              if (!legacy) continue;
              const candidate = JSON.parse(legacy) as Partial<TimelineState>;
              const legacyPool = (candidate as { pool?: unknown }).pool;
              const candidatePool = legacyPool === "hardcore" || legacyPool === "extended" ? "hardcore" : "normal";
              if (candidatePool !== requestedPool) continue;
              stored = candidate;
              migratedLegacyKey = key;
              break;
            }
          }
        } catch {
          stored = null;
        }
        const restored = restoreTimelineRound(stored, songs, requestedPool);
        const state = (restored ?? createTimelineRound({ pool: requestedPool, songs })) as TimelineState;
        if (cancelled) return;
        if (!restored && stored) {
          setToast("玩法已更新，旧本局无法恢复，已重新抽取题目");
          window.setTimeout(() => setToast(""), 2800);
        }
        setGame(state);
        setPool(state.pool);
        writeGame(state);
        if (state.finished) saveFinishedResult(state);
        if (migratedLegacyKey) {
          try { localStorage.removeItem(migratedLegacyKey); } catch { /* storage is optional */ }
        }
        setLoadError("");
        try {
          if (localStorage.getItem(RULES_STORAGE_KEY) !== "seen") setShowRules(true);
        } catch { setShowRules(true); }
      })();
    });
    return () => { cancelled = true; window.cancelAnimationFrame(frame); };
  }, [saveFinishedResult]);

  function place(slot: number) {
    if (!game || game.finished || busy) return;
    setBusy(true);
    try {
      const state = placeTimeline(game, POOLS[pool], slot) as TimelineState;
      setGame(state);
      writeGame(state);
      if (game.placements.length === 0) {
        trackGameEvent({ event: "game_engaged", roundId: game.roundId, mode: "timeline", pool: game.pool });
      }
      if (state.finished) {
        saveFinishedResult(state);
        trackGameEvent({
          event: "game_completed",
          roundId: state.roundId,
          mode: "timeline",
          pool: state.pool,
          outcome: "completed",
          attempts: state.placements.length,
          score: state.score,
        });
      }
      setToast(state.lastPlacement?.correct ? "放对了！" : `差一点，正确日期是 ${formatDate(state.lastPlacement?.song.publicationDate ?? "")}`);
      window.setTimeout(() => setToast(""), 2600);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "放置失败，请重试");
      window.setTimeout(() => setToast(""), 2400);
    } finally {
      setBusy(false);
    }
  }

  function closeRules() {
    try { localStorage.setItem(RULES_STORAGE_KEY, "seen"); } catch { /* optional */ }
    setShowRules(false);
  }

  if (!game) {
    return (
      <main className="site-shell timeline-shell loading-screen">
        <span className="loading-mark">哎</span>
        <strong>{loadError || "正在启动时光机…"}</strong>
        {loadError && <button className="onboarding-start" onClick={() => window.location.reload()}>刷新后继续游玩</button>}
      </main>
    );
  }

  const currentTurn = Math.min(game.maxPlacements, game.placements.length + 1);
  const locked = game.placements.length > 0 || game.finished;

  function changeCatalog(targetPool: PoolName) {
    if (locked || busy || targetPool === pool) return;
    void (async () => {
      const changed = startRound(targetPool);
      if (!changed) return;
      setToast(`已切换至${poolLabel(targetPool)}，本局题目已重新抽取`);
      window.setTimeout(() => setToast(""), 2600);
    })();
  }

  function replayRound() {
    if (!game || busy) return;
    if (startRound(pool)) {
      trackGameEvent({ event: "replay_requested", roundId: game.roundId, mode: "timeline", pool: game.pool });
    }
  }
  function resetLocalStats() {
    if (!window.confirm(`清除${poolLabel(pool)}的时光机本机战绩？当前这一局会保留。`)) return;
    const next = resetTimelinePoolStats(readStats(), pool) as TimelineStats;
    try { localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(next)); } catch { /* optional */ }
    setStats(next);
    setShowStats(false);
    setToast("本机战绩已清除");
    window.setTimeout(() => setToast(""), 2400);
  }
  const placementByBvid = new Map(game.placements.map((placement) => [placement.bvid, placement]));
  const activeStats = stats.pools[pool];
  const averageScore = activeStats.played ? (activeStats.totalScore / activeStats.played).toFixed(1) : "0.0";

  return (
    <main className="site-shell timeline-shell">
      <GameTopBar activePath="/timeline" catalog={pool} modeLabel="时光机">
          <button className="pk-entry-link" type="button" onClick={() => setShowRules(true)}>说明</button>
          <button className="pk-entry-link" type="button" onClick={() => setShowStats(true)}>战绩</button>
      </GameTopBar>

      <section className="hero timeline-hero">
        <p className="round-status">TIME MACHINE · {poolLabel(pool)}</p>
        <h1>把作品放回，<span>它所在的年代</span></h1>
        <p className="intro">从{poolLabel(pool)}的 {POOL_COUNTS[pool]} 首作品中，看作品名判断发布时间，把它插入正确的时间线。</p>
        <div className="round-meter" aria-label={`当前第 ${currentTurn} 轮，共 ${game.maxPlacements} 轮`}>
          {Array.from({ length: game.maxPlacements }, (_, index) => (
            <span key={index} className={index < game.placements.length ? "used" : index === currentTurn - 1 && !game.finished ? "current" : ""} />
          ))}
          <strong>{game.finished ? game.maxPlacements : currentTurn}</strong><small>/ {game.maxPlacements} 轮</small>
        </div>
      </section>

      <section className="game-panel timeline-panel">
        <CatalogSelector pool={pool} itemCount={POOL_COUNTS[pool]} locked={locked} busy={busy} onChange={changeCatalog} />

        {!game.finished && game.target && (
          <section className="timeline-target" aria-live="polite">
            <div className="timeline-target-cover">
              <strong aria-hidden="true">?</strong>
              <small>年代</small>
            </div>
            <div><small>本轮作品 · 日期暂时隐藏</small><h2>{game.target.name}</h2><p>点击下方时间线中的空位进行放置</p></div>
          </section>
        )}

        <section className="timeline-board" aria-label="作品时间线">
          {!game.finished && <button className="timeline-slot" disabled={busy} onClick={() => void place(0)}><span>放在最前</span></button>}
          {game.timeline.map((song, index) => (
            <div className="timeline-node-wrap" key={song.bvid}>
              {(() => {
                const placement = placementByBvid.get(song.bvid);
                const lastPlacement = game.lastPlacement?.song.bvid === song.bvid;
                const classes = [
                  lastPlacement ? `just-placed ${game.lastPlacement?.correct ? "correct" : "wrong"}` : "",
                  placement && !placement.correct ? "placement-wrong" : "",
                ].filter(Boolean).join(" ");
                return (
                  <article className={classes}>
                <time>{formatDate(song.publicationDate)}</time>
                <strong>{song.name}</strong>
                    {placement && !placement.correct && (
                      <div className="timeline-placement-note" role="status">
                        <b>✕ 放置错误</b>
                        <span>你选了第 {placement.chosenSlot + 1} 个空位，正确应在{formatSlotRange(placement.correctSlotStart, placement.correctSlotEnd)}。</span>
                      </div>
                    )}
                  </article>
                );
              })()}
              {!game.finished && <button className="timeline-slot" disabled={busy} onClick={() => void place(index + 1)}><span>{index === game.timeline.length - 1 ? "放在最后" : "放在这里"}</span></button>}
            </div>
          ))}
        </section>

        {game.finished && (
          <section className="timeline-result">
            <p className="round-status">JOURNEY COMPLETE</p>
            <h2>{game.score} / {game.maxPlacements}</h2>
            <p>{game.score === game.maxPlacements ? "全部放对，时间线完全复原。" : game.score >= 6 ? "大部分年代都认对了。" : "再坐一次时光机，记住这些日期吧。"}</p>
            <button className="primary" type="button" onClick={replayRound}>再来一趟 →</button>
          </section>
        )}
      </section>

      <footer>
        <div className="footer-meta"><span>时光机 · {poolLabel(pool)} · 10 轮</span><span>战绩仅保存在当前浏览器。</span></div>
        <button type="button" onClick={() => setShowRules(true)}>收录与判定规则</button>
      </footer>

      <RulesDialog open={showRules} onClose={closeRules} mode="timeline" />

      {showStats && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowStats(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="timeline-stats-title">
            <button className="modal-close" type="button" onClick={() => setShowStats(false)} aria-label="关闭">×</button>
            <h2 id="timeline-stats-title">{poolLabel(pool)} · 时光机战绩</h2>
            <div className="stats-grid">
              <div><strong>{activeStats.played}</strong><span>游玩</span></div>
              <div><strong>{averageScore}</strong><span>平均得分</span></div>
              <div><strong>{activeStats.bestScore}</strong><span>最高得分</span></div>
              <div><strong>{activeStats.perfectRounds}</strong><span>满分次数</span></div>
            </div>
            <h3>得分分布</h3>
            <div className="distribution">
              {activeStats.distribution.map((count, score) => {
                const max = Math.max(...activeStats.distribution, 1);
                return <div key={score}><span>{score}</span><i style={{ width: `${Math.max(8, count / max * 100)}%` }}>{count}</i></div>;
              })}
            </div>
            <button className="reset-button" type="button" onClick={resetLocalStats}>清除当前题库战绩</button>
            <p className="fine-print">标准题库与扩展题库分别统计；当前旅程会保留。</p>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
