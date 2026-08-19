const MODE_LIMITS = { normal: 6, hard: 4 };
const CLUE_LIMIT = 6;

function safeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizePool(value) {
  return value === "hardcore" || value === "extended" ? "hardcore" : "normal";
}

function normalizeModeStats(value, maxGuesses) {
  const distribution = Array.from({ length: maxGuesses }, (_, index) => safeCount(value?.distribution?.[index]));
  return {
    played: safeCount(value?.played),
    wins: safeCount(value?.wins),
    losses: safeCount(value?.losses),
    draws: safeCount(value?.draws),
    streak: safeCount(value?.streak),
    bestStreak: safeCount(value?.bestStreak),
    totalGuesses: safeCount(value?.totalGuesses),
    distribution,
  };
}

function mergeModeStats(left, right, maxGuesses) {
  const first = normalizeModeStats(left, maxGuesses);
  const second = normalizeModeStats(right, maxGuesses);
  return {
    played: first.played + second.played,
    wins: first.wins + second.wins,
    losses: first.losses + second.losses,
    draws: first.draws + second.draws,
    streak: 0,
    bestStreak: Math.max(first.bestStreak, second.bestStreak),
    totalGuesses: first.totalGuesses + second.totalGuesses,
    distribution: first.distribution.map((value, index) => value + second.distribution[index]),
  };
}

function legacyModes(value) {
  return {
    normal: value?.modes?.normal
      ?? mergeModeStats(value?.kinds?.duel?.normal, value?.kinds?.party?.normal, MODE_LIMITS.normal),
    hard: value?.modes?.hard
      ?? mergeModeStats(value?.kinds?.duel?.hard, value?.kinds?.party?.hard, MODE_LIMITS.hard),
  };
}

function normalizeModes(value) {
  return {
    normal: normalizeModeStats(value?.normal, MODE_LIMITS.normal),
    hard: normalizeModeStats(value?.hard, MODE_LIMITS.hard),
  };
}

function normalizeGameStats(value, maxGuesses) {
  return normalizeModeStats(value, maxGuesses);
}

function buildGames(pools) {
  return {
    classic: {
      pools: {
        normal: { modes: pools.normal.modes },
        hardcore: { modes: pools.hardcore.modes },
      },
    },
    clues: {
      pools: {
        normal: { modes: { clues: pools.normal.clues } },
        hardcore: { modes: { clues: pools.hardcore.clues } },
      },
    },
  };
}

export function normalizePkStats(value) {
  const recordedRoundIds = Array.isArray(value?.recordedRoundIds)
    ? [...new Set(value.recordedRoundIds.filter((item) => typeof item === "string" && item.trim()))].slice(-50)
    : [];
  const normalModes = value?.games?.classic?.pools?.normal?.modes
    ?? value?.pools?.normal?.modes
    ?? value?.pools?.normal
    ?? legacyModes(value);
  const hardcoreModes = value?.games?.classic?.pools?.hardcore?.modes
    ?? value?.pools?.hardcore?.modes
    ?? value?.pools?.hardcore
    ?? value?.pools?.extended?.modes
    ?? value?.pools?.extended;
  const normalClues = value?.games?.clues?.pools?.normal?.modes?.clues
    ?? value?.pools?.normal?.clues;
  const hardcoreClues = value?.games?.clues?.pools?.hardcore?.modes?.clues
    ?? value?.pools?.hardcore?.clues
    ?? value?.pools?.extended?.clues;
  const pools = {
    normal: { modes: normalizeModes(normalModes), clues: normalizeGameStats(normalClues, CLUE_LIMIT) },
    hardcore: { modes: normalizeModes(hardcoreModes), clues: normalizeGameStats(hardcoreClues, CLUE_LIMIT) },
  };
  return { schemaVersion: 5, pools, games: buildGames(pools), recordedRoundIds };
}

export function recordPkRound(value, result) {
  const current = normalizePkStats(value);
  const roundId = typeof result?.roundId === "string" ? result.roundId.trim() : "";
  const mode = result?.mode === "hard" ? "hard" : "normal";
  const pool = normalizePool(result?.pool);
  const gameType = result?.gameType === "clues" ? "clues" : "classic";
  if (!roundId || current.recordedRoundIds.includes(roundId)) return current;

  const maxGuesses = gameType === "clues" ? CLUE_LIMIT : MODE_LIMITS[mode];
  const attempts = Math.min(maxGuesses, safeCount(result?.attempts));
  const outcome = ["win", "loss", "draw"].includes(result?.outcome) ? result.outcome : "draw";
  const previous = gameType === "clues" ? current.pools[pool].clues : current.pools[pool].modes[mode];
  const nextMode = {
    ...previous,
    played: previous.played + 1,
    wins: previous.wins + (outcome === "win" ? 1 : 0),
    losses: previous.losses + (outcome === "loss" ? 1 : 0),
    draws: previous.draws + (outcome === "draw" ? 1 : 0),
    streak: outcome === "win" ? previous.streak + 1 : 0,
    bestStreak: outcome === "win" ? Math.max(previous.bestStreak, previous.streak + 1) : previous.bestStreak,
    totalGuesses: previous.totalGuesses + attempts,
    distribution: [...previous.distribution],
  };
  if (outcome === "win" && result?.wonByGuess && attempts > 0) nextMode.distribution[attempts - 1] += 1;

  const next = {
    ...current,
    pools: {
      ...current.pools,
      [pool]: gameType === "clues"
        ? { ...current.pools[pool], clues: nextMode }
        : { ...current.pools[pool], modes: { ...current.pools[pool].modes, [mode]: nextMode } },
    },
    recordedRoundIds: [...current.recordedRoundIds, roundId].slice(-50),
  };
  return { ...next, games: buildGames(next.pools) };
}

export function buildPkShareText({ kindLabel = "多人模式", modeLabel, gameType = "classic", outcome, answerName, players, currentPlayerId, clues = [] }) {
  const history = (players ?? []).map((player) => {
    const label = player.id === currentPlayerId ? "我" : player.name;
    const guesses = gameType === "clues"
      ? (player.clueActions?.length
        ? player.clueActions.map((action) => action.type === "skip" ? "跳过" : `${action.name ?? "未知作品"}${action.correct ? "✓" : ""}`).join(" → ")
        : "本轮未操作")
      : (player.guesses?.length
        ? player.guesses.map((guess) => `${guess.name}${guess.correct ? "✓" : ""}`).join(" → ")
        : "本轮未猜");
    return `${label}：${guesses}`;
  });
  return [
    `哎一把 · ${kindLabel} · ${modeLabel ?? (gameType === "clues" ? "线索阶梯" : "经典推理")}`,
    `结果：${outcome}`,
    `答案：${answerName}`,
    ...(gameType === "clues" && clues.length
      ? [`线索：${clues.map((clue) => `${clue.label} ${clue.value}`).join(" · ")}`]
      : []),
    ...history,
    "我在和朋友猜 ilem 的作品，你也来一把！",
  ].join("\n");
}
