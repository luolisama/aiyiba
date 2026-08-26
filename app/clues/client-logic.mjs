import { DEFAULT_SITE_ORIGIN, siteUrl } from "../site-origin.mjs";

const EMPTY_POOL_STATS = () => ({
  played: 0,
  wins: 0,
  bestStep: 0,
  totalWinningSteps: 0,
  distribution: [0, 0, 0, 0, 0, 0],
});

function validPoolStats(value) {
  return Boolean(
    value
    && [value.played, value.wins, value.bestStep, value.totalWinningSteps].every((item) => Number.isInteger(item) && item >= 0)
    && Array.isArray(value.distribution)
    && value.distribution.length === 6
    && value.distribution.every((item) => Number.isInteger(item) && item >= 0),
  );
}

function copyPoolStats(value) {
  return { ...value, distribution: [...value.distribution] };
}

export function normalizeClueStats(value) {
  const normal = validPoolStats(value?.pools?.normal) ? copyPoolStats(value.pools.normal) : EMPTY_POOL_STATS();
  const hardcore = validPoolStats(value?.pools?.hardcore) ? copyPoolStats(value.pools.hardcore) : EMPTY_POOL_STATS();
  const recordedRoundIds = Array.isArray(value?.recordedRoundIds)
    ? value.recordedRoundIds.filter((item) => typeof item === "string").slice(-200)
    : [];
  return { schemaVersion: 1, pools: { normal, hardcore }, recordedRoundIds };
}

export function recordClueResult(value, { roundId, pool, won, step }) {
  const next = normalizeClueStats(value);
  if (!roundId || next.recordedRoundIds.includes(roundId)) return next;
  const poolName = pool === "hardcore" ? "hardcore" : "normal";
  const active = next.pools[poolName];
  active.played += 1;
  if (won) {
    const normalizedStep = Math.min(6, Math.max(1, Number(step) || 1));
    active.wins += 1;
    active.totalWinningSteps += normalizedStep;
    active.bestStep = active.bestStep === 0 ? normalizedStep : Math.min(active.bestStep, normalizedStep);
    active.distribution[normalizedStep - 1] += 1;
  }
  next.recordedRoundIds = [...next.recordedRoundIds, roundId].slice(-200);
  return next;
}

export function resetCluePoolStats(value, pool) {
  const next = normalizeClueStats(value);
  const poolName = pool === "hardcore" ? "hardcore" : "normal";
  next.pools[poolName] = EMPTY_POOL_STATS();
  return next;
}

export function buildClueShareText({ poolLabel, state, playUrl, siteOrigin }) {
  const resolvedPlayUrl = playUrl ?? siteUrl(siteOrigin ?? DEFAULT_SITE_ORIGIN, "/clues");
  const answer = state.answer;
  const outcome = state.won
    ? `第 ${state.actions.length}/6 次猜中 🎉`
    : state.finishReason === "surrender"
      ? `本局已放弃（解锁 ${state.clues.length}/5 条线索）`
      : "6 次机会已用完";
  const actionLines = state.actions.map((action) => action.type === "skip"
    ? `第 ${action.attempt} 次：跳过`
    : `第 ${action.attempt} 次：${action.name}${action.correct ? " ✓" : " ✗"}`);
  return [
    `哎一把 · 线索阶梯 · ${poolLabel}`,
    outcome,
    "",
    ...state.clues.map((clue, index) => `${index + 1}. ${clue.label}：${clue.value}`),
    "",
    ...actionLines,
    "",
    answer ? `答案：${answer.name}` : "",
    `来挑战线索阶梯：${resolvedPlayUrl}`,
  ].filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== "")).join("\n").trim();
}
