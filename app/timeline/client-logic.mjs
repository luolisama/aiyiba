const MAX_SCORE = 10;

const EMPTY_POOL_STATS = () => ({
  played: 0,
  totalScore: 0,
  bestScore: 0,
  perfectRounds: 0,
  distribution: Array.from({ length: MAX_SCORE + 1 }, () => 0),
});

function validPoolStats(value) {
  return Boolean(
    value
    && [value.played, value.totalScore, value.bestScore, value.perfectRounds]
      .every((item) => Number.isInteger(item) && item >= 0)
    && value.bestScore <= MAX_SCORE
    && value.perfectRounds <= value.played
    && value.totalScore <= value.played * MAX_SCORE
    && Array.isArray(value.distribution)
    && value.distribution.length === MAX_SCORE + 1
    && value.distribution.every((item) => Number.isInteger(item) && item >= 0)
    && value.distribution.reduce((sum, item) => sum + item, 0) === value.played,
  );
}

function copyPoolStats(value) {
  return { ...value, distribution: [...value.distribution] };
}

export function normalizeTimelineStats(value) {
  const normal = validPoolStats(value?.pools?.normal) ? copyPoolStats(value.pools.normal) : EMPTY_POOL_STATS();
  const hardcore = validPoolStats(value?.pools?.hardcore) ? copyPoolStats(value.pools.hardcore) : EMPTY_POOL_STATS();
  const recordedRoundIds = Array.isArray(value?.recordedRoundIds)
    ? [...new Set(value.recordedRoundIds.filter((item) => typeof item === "string" && item))].slice(-200)
    : [];
  return { schemaVersion: 1, pools: { normal, hardcore }, recordedRoundIds };
}

export function recordTimelineResult(value, { roundId, pool, score }) {
  const next = normalizeTimelineStats(value);
  if (!roundId || next.recordedRoundIds.includes(roundId)) return next;
  const poolName = pool === "hardcore" ? "hardcore" : "normal";
  const normalizedScore = Math.min(MAX_SCORE, Math.max(0, Math.round(Number(score) || 0)));
  const active = next.pools[poolName];
  active.played += 1;
  active.totalScore += normalizedScore;
  active.bestScore = Math.max(active.bestScore, normalizedScore);
  if (normalizedScore === MAX_SCORE) active.perfectRounds += 1;
  active.distribution[normalizedScore] += 1;
  next.recordedRoundIds = [...next.recordedRoundIds, roundId].slice(-200);
  return next;
}

export function resetTimelinePoolStats(value, pool) {
  const next = normalizeTimelineStats(value);
  const poolName = pool === "hardcore" ? "hardcore" : "normal";
  next.pools[poolName] = EMPTY_POOL_STATS();
  return next;
}
