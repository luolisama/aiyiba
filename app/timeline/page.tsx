"use client";

import Link from "next/link";
import RulesDialog from "../rules-dialog";
import { useCallback, useEffect, useState } from "react";
import searchSongsJson from "../data/search-songs.json";
import hardcoreSearchSongsJson from "../data/hardcore-search-songs.json";
import songsJson from "../data/songs.json";
import hardcoreSongsJson from "../data/hardcore-songs.json";
import CatalogSelector from "../catalog-selector";
import {
  createTimelineRound,
  placeTimeline,
  restoreTimelineRound,
} from "../local-game-engine.mjs";

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

const GAME_STORAGE_KEY = "aiyiba-timeline-game-v1";
const LOCAL_GAME_STORAGE_KEY = "aiyiba-timeline-game-v2";
const POOLS = {
  normal: songsJson.items,
  hardcore: hardcoreSongsJson.items,
} as const;
const RULES_STORAGE_KEY = "aiyiba-timeline-rules-seen-v1";

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
    localStorage.setItem(LOCAL_GAME_STORAGE_KEY, JSON.stringify(safe));
    localStorage.removeItem(GAME_STORAGE_KEY);
  }
  catch { /* storage is optional */ }
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
        let stored: Partial<TimelineState> | null = null;
        try {
          const raw = localStorage.getItem(LOCAL_GAME_STORAGE_KEY) ?? localStorage.getItem(GAME_STORAGE_KEY);
          stored = raw ? JSON.parse(raw) as Partial<TimelineState> : null;
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
        setLoadError("");
        try {
          if (localStorage.getItem(RULES_STORAGE_KEY) !== "seen") setShowRules(true);
        } catch { setShowRules(true); }
      })();
    });
    return () => { cancelled = true; window.cancelAnimationFrame(frame); };
  }, []);

  function place(slot: number) {
    if (!game || game.finished || busy) return;
    setBusy(true);
    try {
      const state = placeTimeline(game, POOLS[pool], slot) as TimelineState;
      setGame(state);
      writeGame(state);
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
  const placementByBvid = new Map(game.placements.map((placement) => [placement.bvid, placement]));

  return (
    <main className="site-shell timeline-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="返回哎一把主页">
          <span className="brand-note">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ilem-avatar.jpg" alt="ilem头像" />
          </span>
          <span>哎一把 · 时光机</span>
        </Link>
        <div className="header-actions">
          <button className="pk-entry-link" type="button" onClick={() => setShowRules(true)}>说明</button>
          <Link className="pk-entry-link home-return-link" href="/">↩ 主页</Link>
        </div>
      </header>

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
            <button className="primary" type="button" onClick={() => void startRound(pool)}>再来一趟 →</button>
          </section>
        )}
      </section>

      <footer>
        <div className="footer-meta"><span>时光机 · {poolLabel(pool)} · 10 轮</span><span>本玩法暂不记录战绩。</span></div>
        <button type="button" onClick={() => setShowRules(true)}>收录与判定规则</button>
      </footer>

      <RulesDialog open={showRules} onClose={closeRules} mode="timeline" />

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
