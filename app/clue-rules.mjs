import { countTitleCharacters, formatTier } from "./game-logic.mjs";

export const CLUE_MAX_ATTEMPTS = 6;
export const CLUE_COUNT = 5;

export function clueDefinitions(answer) {
  return [
    { key: "engine", label: "引擎", value: answer.engines.join("、") || "无" },
    { key: "tier", label: "播放等级", value: formatTier(answer.viewTier) },
    { key: "vocalist", label: "演唱", value: answer.vocalists.join("、") || "无" },
    { key: "year", label: "投稿年份", value: answer.publicationDate.slice(0, 4) },
    { key: "length", label: "歌名字数", value: `${countTitleCharacters(answer.name)}字` },
  ];
}
