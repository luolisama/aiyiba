"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import clueSearchJson from "../data/clue-search-songs.json";
import hardcoreClueSearchJson from "../data/hardcore-clue-search-songs.json";
import hardcoreSongPinyinJson from "../data/hardcore-song-pinyin.json";
import songPinyinJson from "../data/song-pinyin.json";
import { matchesSongQuery, normalizeSearchText } from "../game-logic.mjs";
import { isExtendedOnlySong } from "../catalog-logic.mjs";
import ShareImageDialog from "../share-image-dialog";
import RulesDialog from "../rules-dialog";
import { isRoundInvalidatedError, ROUND_INVALIDATED_MESSAGE } from "../round-errors.mjs";
import type { ShareCardModel } from "../share-card";
import { buildClueShareCardModel } from "../share-card-model.mjs";
import { normalizeClueStats, recordClueResult, resetCluePoolStats } from "./client-logic.mjs";

type PoolName = "normal" | "hardcore";
type FinishReason = "guessed" | "attempts" | "surrender" | null;
type SearchSong = { bvid: string; name: string; searchAliases?: string[]; searchPinyin?: string[] };
type Clue = { key: string; label: string; value: string };
type ClueAction = { type: "guess" | "skip"; attempt: number; bvid?: string; name?: string; correct: boolean };
type Answer = {
  bvid: string;
  name: string;
  publicationDate: string;
  vocalists: string[];
  engines: string[];
  views: number | null;
  viewTier: string;
  coverUrl: string;
  bilibiliUrl: string;
};
type GameState = {
  roundId: string;
  pool: PoolName;
  maxAttempts?: number;
  clueCount?: number;
  clues: Clue[];
  actions: ClueAction[];
  finished: boolean;
  won: boolean;
  finishReason: FinishReason;
  poolProgress: number;
  poolSize: number;
  answer?: Answer;
};
type PoolStats = { played: number; wins: number; bestStep: number; totalWinningSteps: number; distribution: number[] };
type ClueStats = { schemaVersion: number; pools: Record<PoolName, PoolStats>; recordedRoundIds: string[] };

const GAME_STORAGE_KEY = "aiyiba-clues-game-v1";
const STATS_STORAGE_KEY = "aiyiba-clues-stats-v1";
const RULES_STORAGE_KEY = "aiyiba-clues-rules-seen-v1";
const CLIENT_STORAGE_KEY = "aiyiba-singleplayer-client-v1";

const POOLS: Record<PoolName, { items: SearchSong[]; itemCount: number }> = {
  normal: {
    itemCount: clueSearchJson.itemCount,
    items: clueSearchJson.items.map((song) => ({
      ...song,
      searchPinyin: [songPinyinJson[song.bvid as keyof typeof songPinyinJson]].filter(Boolean),
    })),
  },
  hardcore: {
    itemCount: hardcoreClueSearchJson.itemCount,
    items: hardcoreClueSearchJson.items.map((song) => ({
      ...song,
      searchPinyin: [hardcoreSongPinyinJson[song.bvid as keyof typeof hardcoreSongPinyinJson]].filter(Boolean),
    })),
  },
};
const STANDARD_BVIDS = new Set(POOLS.normal.items.map((song) => song.bvid));

function poolFromLocation(): PoolName {
  if (typeof window === "undefined") return "normal";
  const value = new URLSearchParams(window.location.search).get("catalog");
  return value === "extended" || value === "hardcore" ? "hardcore" : "normal";
}

function poolLabel(pool: PoolName) {
  return pool === "hardcore" ? "扩展题库" : "标准题库";
}

function apiPool(pool: PoolName) {
  return pool === "hardcore" ? "extended" : "normal";
}

function updateCatalogUrl(pool: PoolName) {
  const url = new URL(window.location.href);
  if (pool === "hardcore") url.searchParams.set("catalog", "extended");
  else url.searchParams.delete("catalog");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

function clientId() {
  try {
    const saved = localStorage.getItem(CLIENT_STORAGE_KEY)?.trim();
    if (saved) return saved;
    const created = globalThis.crypto?.randomUUID?.() ?? `clue-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(CLIENT_STORAGE_KEY, created);
    return created;
  } catch {
    return `clue-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

async function clueRequest(message: Record<string, unknown>) {
  const response = await fetch("/api/clues", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(message),
  });
  let body: { state?: GameState; error?: string; code?: string } = {};
  try { body = await response.json() as typeof body; } catch { /* handled below */ }
  if (!response.ok) {
    const error = new Error(body.error ?? "线索服务暂时不可用");
    (error as Error & { status?: number; code?: string }).status = response.status;
    (error as Error & { status?: number; code?: string }).code = body.code;
    throw error;
  }
  return body.state;
}

function readStats(): ClueStats {
  try { return normalizeClueStats(JSON.parse(localStorage.getItem(STATS_STORAGE_KEY) ?? "null")) as ClueStats; }
  catch { return normalizeClueStats() as ClueStats; }
}

function writeGame(state: GameState) {
  try {
    const safe = { ...state };
    delete safe.answer;
    localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(safe));
  } catch { /* storage is optional */ }
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function formatViews(value: number | null) {
  if (value === null) return "播放量待核";
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 1_000_000 ? 0 : 1)}万播放`;
  return `${value.toLocaleString("zh-CN")}播放`;
}

export default function ClueLadderPage() {
  const [pool, setPool] = useState<PoolName>(poolFromLocation);
  const [game, setGame] = useState<GameState | null>(null);
  const [stats, setStats] = useState<ClueStats>(() => normalizeClueStats() as ClueStats);
  const [query, setQuery] = useState("");
  const [selectedBvid, setSelectedBvid] = useState<string | null>(null);
  const [activeOption, setActiveOption] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState("");
  const [showRules, setShowRules] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [showSurrender, setShowSurrender] = useState(false);
  const [shareCard, setShareCard] = useState<ShareCardModel | null>(null);

  const saveFinishedResult = useCallback((state: GameState) => {
    if (!state.finished) return;
    const next = recordClueResult(readStats(), {
      roundId: state.roundId,
      pool: state.pool,
      won: state.won,
      step: state.actions.length,
    }) as ClueStats;
    try { localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(next)); } catch { /* optional */ }
    setStats(next);
  }, []);

  const startRound = useCallback(async (targetPool: PoolName) => {
    setBusy(true);
    try {
      const state = await clueRequest({ action: "start", pool: apiPool(targetPool), clientId: clientId() });
      if (!state) throw new Error("线索服务没有返回题目");
      setPool(targetPool);
      setGame(state);
      writeGame(state);
      updateCatalogUrl(targetPool);
      setQuery("");
      setSelectedBvid(null);
      setShowResult(false);
      setShowSurrender(false);
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "线索服务暂时不可用");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      void (async () => {
        setStats(readStats());
        const requestedPool = poolFromLocation();
        let state: GameState | undefined;
        try {
          const stored = JSON.parse(localStorage.getItem(GAME_STORAGE_KEY) ?? "null") as Partial<GameState> | null;
          if (stored?.roundId && stored.pool === requestedPool) {
            try { state = await clueRequest({ action: "resume", roundId: stored.roundId }); } catch { state = undefined; }
          }
          if (!state) state = await clueRequest({ action: "start", pool: apiPool(requestedPool), clientId: clientId() });
          if (!state) throw new Error("线索服务没有返回题目");
          if (cancelled) return;
          setGame(state);
          writeGame(state);
          setPool(state.pool);
          if (state.finished) {
            saveFinishedResult(state);
            setShowResult(true);
          }
          setLoadError("");
        } catch (error) {
          if (!cancelled) setLoadError(error instanceof Error ? error.message : "线索服务暂时不可用");
        }
        try {
          if (localStorage.getItem(RULES_STORAGE_KEY) !== "seen") setShowRules(true);
        } catch { setShowRules(true); }
      })();
    });
    return () => { cancelled = true; window.cancelAnimationFrame(frame); };
  }, [saveFinishedResult]);

  const guessedBvids = useMemo(() => new Set(game?.actions.filter((action) => action.type === "guess").map((action) => action.bvid)), [game]);
  const matches = useMemo(() => {
    const needle = normalizeSearchText(query);
    if (!needle) return [];
    return POOLS[pool].items.filter((song) => !guessedBvids.has(song.bvid) && matchesSongQuery(song, needle)).slice(0, 8);
  }, [query, pool, guessedBvids]);
  const explicitlySelected = POOLS[pool].items.find((song) => song.bvid === selectedBvid);
  const exactQueryMatch = matches.find((song) => matchesSongQuery(song, query, true));
  const selected = explicitlySelected ?? exactQueryMatch;
  const currentClue = game?.clues.at(-1);
  const maxAttempts = game?.maxAttempts ?? 6;
  const clueCount = game?.clueCount ?? 5;
  const currentAttempt = game ? (game.finished ? game.actions.length : Math.min(maxAttempts, game.actions.length + 1)) : 1;
  const currentClueNumber = game?.clues.length ?? 1;
  const isFinalAttempt = !game?.finished && currentAttempt === maxAttempts;
  const locked = Boolean(game?.actions.length || game?.finished);
  const activeStats = stats.pools[pool];
  const winRate = activeStats.played ? Math.round(activeStats.wins / activeStats.played * 100) : 0;
  const averageStep = activeStats.wins ? (activeStats.totalWinningSteps / activeStats.wins).toFixed(1) : "—";

  async function perform(action: "guess" | "skip", bvid?: string) {
    if (!game || game.finished || busy) return;
    setBusy(true);
    try {
      const state = await clueRequest({ action, roundId: game.roundId, bvid });
      if (!state) throw new Error("线索服务没有返回结果");
      setGame(state);
      writeGame(state);
      setQuery("");
      setSelectedBvid(null);
      setActiveOption(0);
      if (state.finished) {
        saveFinishedResult(state);
        window.setTimeout(() => setShowResult(true), 280);
      }
    } catch (error) {
      if (isRoundInvalidatedError(error)) {
        setGame(null);
        setLoadError(ROUND_INVALIDATED_MESSAGE);
        return;
      }
      setToast(error instanceof Error ? error.message : "操作失败，请重试");
      window.setTimeout(() => setToast(""), 2400);
    } finally {
      setBusy(false);
    }
  }

  async function surrender() {
    if (!game || game.finished || busy) return;
    setBusy(true);
    try {
      const state = await clueRequest({ action: "surrender", roundId: game.roundId });
      if (!state) throw new Error("线索服务没有返回结果");
      setGame(state);
      writeGame(state);
      saveFinishedResult(state);
      setShowSurrender(false);
      setShowResult(true);
    } catch (error) {
      if (isRoundInvalidatedError(error)) {
        setGame(null);
        setLoadError(ROUND_INVALIDATED_MESSAGE);
        setShowSurrender(false);
        return;
      }
      setToast(error instanceof Error ? error.message : "操作失败，请重试");
    } finally { setBusy(false); }
  }

  function closeRules() {
    try { localStorage.setItem(RULES_STORAGE_KEY, "seen"); } catch { /* optional */ }
    setShowRules(false);
  }

  function shareResult() {
    if (!game?.finished || !game.answer) return;
    setShareCard(buildClueShareCardModel({ poolLabel: poolLabel(pool), state: game }) as ShareCardModel);
  }

  async function resetLocalRecord() {
    if (!window.confirm(`清除${poolLabel(pool)}的本机战绩和抽题历史？当前这一局会保留。`)) return;
    const next = resetCluePoolStats(readStats(), pool) as ClueStats;
    try { localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(next)); } catch { /* storage is optional */ }
    try {
      await clueRequest({ action: "reset-pool", pool: apiPool(pool), clientId: clientId() });
    } catch {
      // Local statistics can still be cleared if the server is temporarily unavailable.
    }
    setStats(next);
    setShowStats(false);
    setToast("本机记录已清除");
    window.setTimeout(() => setToast(""), 2200);
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!matches.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveOption((value) => (value + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveOption((value) => (value - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const song = selected ?? matches[activeOption] ?? matches[0];
      if (selected) void perform("guess", song.bvid);
      else { setSelectedBvid(song.bvid); setQuery(song.name); }
    }
  }

  if (!game) {
    return (
      <main className="site-shell clue-shell loading-screen">
        <span className="loading-mark">哎</span>
        <strong>{loadError || "正在抽取线索…"}</strong>
        {loadError && <button className="onboarding-start" onClick={() => window.location.reload()}>刷新后继续游玩</button>}
      </main>
    );
  }

  return (
    <main className="site-shell clue-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="返回哎一把主页">
          <span className="brand-note">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ilem-avatar.jpg" alt="ilem头像" />
          </span>
          <span>哎一把 · 线索阶梯</span>
        </Link>
        <div className="header-actions">
          <button className="pk-entry-link" onClick={() => setShowRules(true)}>说明</button>
          <button className="pk-entry-link" onClick={() => setShowStats(true)}>战绩</button>
          <Link className="pk-entry-link home-return-link" href="/">↩ 主页</Link>
        </div>
      </header>

      <section className="hero clue-hero">
        <p className="round-status">CLUE LADDER · {poolLabel(pool)}</p>
        <h1>一层一层，<span>揭开这首作品</span></h1>
        <p className="intro">前四次猜错或跳过会揭示下一条线索；第五次未命中后，保留现有线索进行最后作答。</p>
        <div className="round-meter" aria-label={`当前第 ${currentAttempt} 次机会，共 ${maxAttempts} 次`}>
          {Array.from({ length: maxAttempts }, (_, index) => (
            <span key={index} className={index < game.actions.length ? "used" : index === currentAttempt - 1 && !game.finished ? "current" : ""} />
          ))}
          <strong>{game.finished ? game.actions.length : currentAttempt}</strong><small>/ {maxAttempts} 次</small>
        </div>
      </section>

      <section className="game-panel clue-panel">
        <div className="mode-bar clue-catalog-bar">
          <div className="mode-copy">
            <strong>{poolLabel(pool)}</strong>
            <span>{POOLS[pool].itemCount} 首作品 · 首次行动后锁定</span>
          </div>
          <div className="mode-actions">
            <button className={pool === "normal" ? "active" : ""} disabled={locked || busy} onClick={() => void startRound("normal")}>标准</button>
            <button className={pool === "hardcore" ? "active" : ""} disabled={locked || busy} onClick={() => void startRound("hardcore")}>扩展</button>
          </div>
        </div>

        <section className="clue-current" aria-live="polite">
          <span className="clue-step-mark">{currentClueNumber.toString().padStart(2, "0")}</span>
          <div><small>当前线索 · {currentClue?.label}</small><strong>{currentClue?.value}</strong></div>
          {!game.finished && <em>{isFinalAttempt ? "最终机会 · 线索不变" : `第 ${currentClueNumber} 条线索`}</em>}
        </section>

        <div className="search-row clue-search-row">
          <div className="search-box">
            <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
            <input
              value={query}
              disabled={game.finished || busy}
              onChange={(event) => { setQuery(event.target.value); setSelectedBvid(null); setActiveOption(0); }}
              onKeyDown={onSearchKeyDown}
              placeholder={game.finished ? "本局已结束" : "输入作品名或拼音搜索…"}
              aria-label="搜索作品"
              autoComplete="off"
            />
            {query && !game.finished && !selectedBvid && (
              <div className="suggestions" role="listbox">
                {matches.length ? matches.map((song, index) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedBvid === song.bvid}
                    className={index === activeOption ? "active" : ""}
                    key={song.bvid}
                    onMouseEnter={() => setActiveOption(index)}
                    onClick={() => { setSelectedBvid(song.bvid); setQuery(song.name); }}
                  ><span>{song.name}</span><small>选择</small></button>
                )) : <p className="no-match">没有找到未猜过的作品</p>}
              </div>
            )}
          </div>
          <button className="guess-button" disabled={!selected || game.finished || busy} onClick={() => selected && void perform("guess", selected.bvid)}>提交答案 <span>↵</span></button>
          {!game.finished && <button className="clue-skip-button" disabled={busy} onClick={() => void perform("skip")}>{isFinalAttempt ? "跳过并结束" : game.clues.length === clueCount ? "跳过，进入最终机会" : "跳过，下一条"} →</button>}
        </div>

        {!game.finished && (
          <div className="clue-secondary-actions">
            <button className="surrender-button" onClick={() => setShowSurrender(true)}>直接看答案并放弃</button>
          </div>
        )}

        {isFinalAttempt && <p className="clue-final-notice" role="status">第 5 次作答未命中，最后一次机会不会再揭示新线索。</p>}

        <section className="clue-history" aria-label="已揭示线索和行动记录">
          <div className="clue-history-heading"><h2>已揭示的线索</h2><span>最新线索在最上方</span></div>
          {[...game.clues].reverse().map((clue, reverseIndex) => {
            const originalIndex = game.clues.length - reverseIndex - 1;
            const action = game.actions[originalIndex - 1];
            return (
              <article className={reverseIndex === 0 && !game.finished ? "active" : ""} key={clue.key}>
                <span>{(originalIndex + 1).toString().padStart(2, "0")}</span>
                <div><small>{clue.label}</small><strong>{clue.value}</strong></div>
                {action && <p>{action.type === "skip" ? "上一层选择跳过" : <>上一层猜了 <b>{action.name}</b>{action.correct ? "，猜中" : "，未猜中"}</>}</p>}
              </article>
            );
          })}
        </section>

        {game.finished && game.answer && (
          <section className="round-summary" aria-label="本局答案">
            <div><p className="round-status">{game.won ? "LADDER CLEARED" : "ROUND ENDED"}</p><h2>{game.answer.name}</h2><p>{game.won ? `第 ${game.actions.length} 次猜中` : "答案已经揭晓"}</p></div>
            <div className="summary-actions"><button onClick={() => setShowResult(true)}>查看完整结果</button><button className="primary" onClick={() => void startRound(pool)}>再来一把 →</button></div>
          </section>
        )}
      </section>

      <footer>
        <div className="footer-meta">
          <span>线索阶梯 · {poolLabel(pool)} · 题袋 {game.poolProgress}/{game.poolSize}</span>
          <span className="credits">如果对这个项目有什么意见或者数据有误联系<a href="https://space.bilibili.com/477277447/" target="_blank" rel="noreferrer">叁忆玖</a>。记得支持i12喵，关注<a href="https://space.bilibili.com/372295491" target="_blank" rel="noreferrer">站宝</a>喵，关注<a href="https://space.bilibili.com/372295491" target="_blank" rel="noreferrer">站宝</a>谢谢喵！</span>
        </div>
        <button onClick={() => setShowRules(true)}>收录与判定规则</button>
      </footer>

      <RulesDialog open={showRules} onClose={closeRules} mode="clues" />

      {showStats && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowStats(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="clue-stats-title">
            <button className="modal-close" onClick={() => setShowStats(false)} aria-label="关闭">×</button>
            <h2 id="clue-stats-title">{poolLabel(pool)} · 阶梯战绩</h2>
            <div className="stats-grid clue-stats-grid">
              <div><strong>{activeStats.played}</strong><span>游玩</span></div>
              <div><strong>{winRate}%</strong><span>胜率</span></div>
              <div><strong>{activeStats.bestStep || "—"}</strong><span>最佳次数</span></div>
              <div><strong>{averageStep}</strong><span>平均次数</span></div>
            </div>
            <h3>猜中次数分布</h3>
            <div className="distribution">
              {activeStats.distribution.map((count, index) => {
                const max = Math.max(...activeStats.distribution, 1);
                return <div key={index}><span>{index + 1}</span><i style={{ width: `${Math.max(8, count / max * 100)}%` }}>{count}</i></div>;
              })}
            </div>
            <p className="shoe-progress">本轮题袋已抽取 <b>{game.poolProgress}</b> / {game.poolSize} 首，用完前不会重复。</p>
            <button className="reset-button" type="button" onClick={() => void resetLocalRecord()}>清除本机战绩与抽题历史</button>
            <p className="fine-print">标准题库与扩展题库分别统计；当前挑战会保留。</p>
          </section>
        </div>
      )}

      {showSurrender && !game.finished && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowSurrender(false)}>
          <section className="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="clue-surrender-title">
            <button className="modal-close" onClick={() => setShowSurrender(false)} aria-label="关闭">×</button>
            <h2 id="clue-surrender-title">确定直接看答案？</h2>
            <p>这会结束当前挑战，并在本机战绩中记为一次失败。</p>
            <div className="confirm-actions"><button onClick={() => setShowSurrender(false)}>继续挑战</button><button className="danger" onClick={() => void surrender()}>放弃并看答案</button></div>
          </section>
        </div>
      )}

      {showResult && game.finished && game.answer && (
        <div className="modal-backdrop result-backdrop" role="presentation">
          <section className={`modal result-modal ${game.won ? "won" : ""}`} role="dialog" aria-modal="true" aria-labelledby="clue-result-title">
            <button className="modal-close" onClick={() => setShowResult(false)} aria-label="暂时关闭">×</button>
            <div className="answer-cover">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={game.answer.coverUrl} alt={`${game.answer.name} 的视频封面`} referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = "/og.png"; }} />
            </div>
            <div className="victory-banner"><span className="victory-check">{game.won ? "✓" : "!"}</span><div><strong>{game.won ? "认出来了！" : "答案揭晓"}</strong></div><em>{game.won ? `第 ${game.actions.length} 次命中` : `解锁了 ${game.clues.length} 条线索`}</em></div>
            {isExtendedOnlySong(game.pool, game.answer.bvid, STANDARD_BVIDS) && <p className="extended-badge">✦ 扩展题</p>}
            <h2 id="clue-result-title">{game.answer.name}</h2>
            <p className="answer-meta">{game.answer.vocalists.join("、") || "无"} · {game.answer.engines.join("、") || "无"} · {formatDate(game.answer.publicationDate)}</p>
            <div className="answer-chips"><span>{game.answer.viewTier.replace(/曲$/u, "")}</span><span>{formatViews(game.answer.views)}</span><span>第 {game.actions.length} 次结束</span></div>
            <div className="result-actions">{game.answer.bilibiliUrl ? <a href={game.answer.bilibiliUrl} target="_blank" rel="noreferrer">去 B 站听 ↗</a> : <span className="result-link-unavailable">原投稿已不可访问</span>}<button onClick={shareResult}>生成战绩图</button></div>
            <button className="again-button" onClick={() => void startRound(pool)}>再来一把 <span>→</span></button>
          </section>
        </div>
      )}

      {shareCard && <ShareImageDialog model={shareCard} onClose={() => setShareCard(null)} />}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
