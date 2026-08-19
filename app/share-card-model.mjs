import { countTitleCharacters, formatTier } from "./game-logic.mjs";

function formatDate(value) {
  const [year, month, day] = String(value ?? "").split("-");
  if (!year || !month || !day) return String(value ?? "");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function formatViews(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "播放量待核";
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 1_000_000 ? 0 : 1)}万播放`;
  return `${value.toLocaleString("zh-CN")}播放`;
}

function answerDetails(answer) {
  return [formatTier(answer?.viewTier), formatViews(answer?.views), `${countTitleCharacters(answer?.name)}字歌名`]
    .filter(Boolean)
    .join(" · ");
}

function answerMeta(answer) {
  const vocalists = answer?.vocalists?.join("、") || "无";
  const engines = answer?.engines?.join("、") || "无";
  return `${vocalists} · ${engines} · ${formatDate(answer?.publicationDate)}`;
}

function cellDetail(cell) {
  if (!cell) return "";
  return `${cell.text || "无"}${cell.hint ? ` ${cell.hint}` : ""}`;
}

const SINGLE_FIELD_LABELS = ["作品", "演唱", "引擎", "字数", "日期", "等级"];

/** @param {any} options */
export function buildSingleShareCardModel({ poolLabel, modeLabel, won, finishReason, maxGuesses, answer, guesses = [] }) {
  const attemptCount = guesses.length;
  const outcome = won
    ? `第 ${attemptCount} 次猜中`
    : finishReason === "surrender"
      ? "本局已放弃"
      : "本局未猜中";
  return {
    gameLabel: `${poolLabel} · ${modeLabel}`,
    outcome,
    outcomeDetail: won ? `${attemptCount}/${maxGuesses} 次机会` : `已使用 ${attemptCount}/${maxGuesses} 次机会`,
    answerName: answer.name,
    answerMeta: answerMeta(answer),
    answerDetail: answerDetails(answer),
    rows: guesses.map((guess, index) => ({
      label: `第 ${index + 1} 次`,
      title: guess.cells?.[0]?.text || "未知作品",
      detail: `${cellDetail(guess.cells?.[4])} · ${cellDetail(guess.cells?.[5])}`,
      tones: (guess.cells ?? []).map((cell) => cell.tone),
      fields: (guess.cells ?? []).slice(1).map((cell, cellIndex) => ({
        label: SINGLE_FIELD_LABELS[cellIndex + 1],
        value: cellDetail(cell),
        tone: cell.tone,
      })),
    })),
    footer: "来猜 ilem 的作品",
    url: "aiyiba.getuphole.top/solo",
  };
}

/** @param {any} options */
export function buildClueShareCardModel({ poolLabel, state }) {
  const answer = state.answer;
  const outcome = state.won
    ? `第 ${state.actions.length} 次猜中`
    : state.finishReason === "surrender"
      ? "本轮已放弃"
      : "本轮未猜中";
  return {
    gameLabel: `线索阶梯 · ${poolLabel}`,
    outcome,
    outcomeDetail: `揭示 ${state.clues.length}/${state.clueCount ?? 5} 条线索`,
    answerName: answer.name,
    answerMeta: answerMeta(answer),
    answerDetail: answerDetails(answer),
    rows: state.actions.map((action) => ({
      label: `第 ${action.attempt} 次`,
      title: action.type === "skip" ? "跳过，揭示下一层" : action.name || "未知作品",
      detail: action.type === "skip" ? `已揭示至第 ${Math.min(action.attempt + 1, state.clueCount ?? 5)} 层` : action.correct ? "认出答案" : "继续揭示线索",
      tones: [action.correct ? "correct" : action.type === "skip" ? "partial" : "wrong"],
    })),
    footer: "一层一层，揭开这首作品",
    url: "aiyiba.getuphole.top/clues",
  };
}

/** @param {any} options */
export function buildPkShareCardModel({ poolLabel, modeLabel, gameType = "classic", outcome, answer, players = [], currentPlayerId, winnerPlayerId, winnerPlayerIds = [], clues = [] }) {
  const winners = new Set(winnerPlayerIds.length ? winnerPlayerIds : winnerPlayerId ? [winnerPlayerId] : []);
  const clueSummary = clues.length ? `已揭示：${clues.map((clue) => `${clue.label} ${clue.value}`).join(" · ")}` : "";
  return {
    gameLabel: `多人模式 · ${poolLabel} · ${gameType === "clues" ? "线索阶梯" : modeLabel}`,
    outcome,
    outcomeDetail: `${players.length} 位玩家同场竞猜${clueSummary ? ` · ${clueSummary}` : ""}`,
    answerName: answer.name,
    answerMeta: answerMeta(answer),
    answerDetail: answerDetails(answer),
    rows: players.map((player) => {
      const guesses = gameType === "clues"
        ? player.clueActions?.map((action) => action.type === "skip" ? `第${action.stage}层跳过` : action.name ?? "未知作品") ?? []
        : player.guesses?.map((guess) => guess.name) ?? [];
      const playerWon = winners.has(player.id);
      return {
        label: player.id === currentPlayerId ? `${player.name}（我）` : player.name,
        title: guesses.length ? guesses.join(" → ") : gameType === "clues" ? "本轮未操作" : "本轮未猜",
        detail: playerWon ? `${player.attempts} 次 · 本局胜者` : `${player.attempts} 次${player.left || player.forfeited ? " · 已弃权" : ""}`,
        tones: [playerWon ? "correct" : "wrong"],
      };
    }),
    footer: "叫上朋友，一起猜 ilem 的作品",
    url: "aiyiba.getuphole.top/multi",
  };
}
