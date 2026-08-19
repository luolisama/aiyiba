export const SHOE_SCHEMA_VERSION = 2;

export function secureRandomIndex(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError("maxExclusive must be a positive integer");
  }
  const range = 0x1_0000_0000;
  const limit = Math.floor(range / maxExclusive) * maxExclusive;
  const values = new Uint32Array(1);
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= limit);
  return values[0] % maxExclusive;
}

export function shuffleBvids(values, nextIndex = secureRandomIndex) {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = nextIndex(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function getPoolKey(allBvids) {
  return [...allBvids].sort().join("|");
}

function assertUniquePool(allBvids) {
  if (new Set(allBvids).size !== allBvids.length) {
    throw new Error("Song pool contains duplicate BVIDs");
  }
}

export function createShoe(allBvids, seenBvids = [], nextIndex = secureRandomIndex) {
  assertUniquePool(allBvids);
  const allowed = new Set(allBvids);
  const seen = [...new Set(seenBvids)].filter((bvid) => allowed.has(bvid));
  const seenSet = new Set(seen);
  return {
    schemaVersion: SHOE_SCHEMA_VERSION,
    poolKey: getPoolKey(allBvids),
    remaining: shuffleBvids(allBvids.filter((bvid) => !seenSet.has(bvid)), nextIndex),
    seen,
    recent: seen.slice(-10),
  };
}

export function isValidShoe(shoe, allBvids) {
  if (!shoe || shoe.schemaVersion !== SHOE_SCHEMA_VERSION) return false;
  if (shoe.poolKey !== getPoolKey(allBvids)) return false;
  if (!Array.isArray(shoe.remaining) || !Array.isArray(shoe.seen)) return false;
  const combined = [...shoe.remaining, ...shoe.seen];
  return (
    combined.length === allBvids.length &&
    new Set(combined).size === allBvids.length &&
    combined.every((bvid) => allBvids.includes(bvid))
  );
}

export function drawFromShoe(shoe, allBvids, previousBvid, nextIndex = secureRandomIndex) {
  assertUniquePool(allBvids);
  let active = isValidShoe(shoe, allBvids)
    ? {
        ...shoe,
        remaining: [...shoe.remaining],
        seen: [...shoe.seen],
        recent: Array.isArray(shoe.recent) ? [...shoe.recent] : [],
      }
    : createShoe(allBvids, previousBvid ? [previousBvid] : [], nextIndex);

  if (!active.remaining.length) {
    active = createShoe(allBvids, [], nextIndex);
  }

  if (active.remaining[0] === previousBvid && active.remaining.length > 1) {
    const differentIndex = active.remaining.findIndex((bvid) => bvid !== previousBvid);
    [active.remaining[0], active.remaining[differentIndex]] = [
      active.remaining[differentIndex],
      active.remaining[0],
    ];
  }

  const answerBvid = active.remaining.shift();
  if (!answerBvid) throw new Error("Cannot draw from an empty song pool");
  active.seen.push(answerBvid);
  active.recent = [...active.recent, answerBvid].slice(-10);
  return { answerBvid, shoe: active };
}

export function countTitleCharacters(value) {
  const compact = String(value ?? "").replace(/\s/gu, "");
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(compact)].length;
  }
  return [...compact].length;
}

export function normalizeSearchText(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase().replaceAll("ü", "v").replaceAll(/\s+/g, "");
}

export function newestFirst(items) {
  return [...items].reverse();
}

export function comparePublicationDate(guessDate, answerDate) {
  const guessValue = String(guessDate ?? "").slice(0, 10);
  const answerValue = String(answerDate ?? "").slice(0, 10);
  const matches = guessValue === answerValue;
  const sameYear = !matches && guessValue.slice(0, 4) === answerValue.slice(0, 4);
  return {
    matches,
    sameYear,
    tone: matches ? "correct" : sameYear ? "partial" : "wrong",
    text: guessValue,
    hint: matches ? undefined : guessValue < answerValue ? "↑ 更晚" : "↓ 更早",
  };
}

export const TIER_ORDER = ["普通曲", "殿堂曲", "专兑曲", "传说曲", "神话曲"];

export function formatTier(value) {
  return String(value ?? "").replace(/曲$/u, "");
}

export function compareSong(guess, answer) {
  const guessLength = countTitleCharacters(guess?.name);
  const answerLength = countTitleCharacters(answer?.name);
  const dateClue = comparePublicationDate(guess?.publicationDate, answer?.publicationDate);
  const guessTier = TIER_ORDER.indexOf(guess?.viewTier);
  const answerTier = TIER_ORDER.indexOf(answer?.viewTier);
  const compareSet = (left = [], right = []) => {
    const sortedLeft = [...left].sort();
    const sortedRight = [...right].sort();
    if (sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index])) return "correct";
    if (left.some((value) => right.includes(value))) return "partial";
    return "wrong";
  };

  return [
    { tone: guess?.bvid === answer?.bvid ? "correct" : "wrong", text: guess?.name ?? "" },
    { tone: compareSet(guess?.vocalists, answer?.vocalists), text: (guess?.vocalists ?? []).join("、") },
    { tone: compareSet(guess?.engines, answer?.engines), text: (guess?.engines ?? []).join("、") },
    {
      tone: guessLength === answerLength ? "correct" : "wrong",
      text: `${guessLength}字`,
      hint: guessLength === answerLength ? undefined : guessLength < answerLength ? "↑ 更长" : "↓ 更短",
    },
    { tone: dateClue.tone, text: dateClue.text, hint: dateClue.hint },
    {
      tone: guess?.viewTier === answer?.viewTier ? "correct" : "wrong",
      text: formatTier(guess?.viewTier),
      hint: guessTier === answerTier ? undefined : guessTier < answerTier ? "↑ 更高" : "↓ 更低",
    },
  ];
}

export function getMaxGuesses(mode) {
  return mode === "hard" ? 4 : 6;
}

function emptyStats() {
  return { played: 0, wins: 0, streak: 0, bestStreak: 0, distribution: [0, 0, 0, 0, 0, 0] };
}

function validStats(value) {
  return Boolean(
    value &&
    [value.played, value.wins, value.streak, value.bestStreak].every((item) => Number.isInteger(item) && item >= 0) &&
    Array.isArray(value.distribution) &&
    value.distribution.length === 6 &&
    value.distribution.every((item) => Number.isInteger(item) && item >= 0),
  );
}

function copyStats(value) {
  return { ...value, distribution: [...value.distribution] };
}

export function normalizeModeStats(value, legacyValue) {
  if (validStats(value?.normal) && validStats(value?.hard)) {
    return { normal: copyStats(value.normal), hard: copyStats(value.hard) };
  }
  if (validStats(legacyValue)) {
    return { normal: copyStats(legacyValue), hard: emptyStats() };
  }
  return { normal: emptyStats(), hard: emptyStats() };
}

export function addModeResult(value, mode, won, attempts, maxGuesses = 6) {
  const next = normalizeModeStats(value);
  const activeMode = mode === "hard" ? "hard" : "normal";
  const current = next[activeMode];
  if (won && attempts >= 1 && attempts <= maxGuesses) current.distribution[attempts - 1] += 1;
  current.played += 1;
  current.wins += won ? 1 : 0;
  current.streak = won ? current.streak + 1 : 0;
  current.bestStreak = won ? Math.max(current.bestStreak, current.streak) : current.bestStreak;
  return next;
}

export function matchesSongQuery(song, query, exact = false) {
  const needle = normalizeSearchText(query);
  if (!needle) return false;
  const candidates = [song?.name, song?.bilibiliTitle, ...(song?.searchAliases ?? []), ...(song?.searchPinyin ?? [])]
    .map(normalizeSearchText)
    .filter(Boolean);
  return candidates.some((candidate) => exact ? candidate === needle : candidate.includes(needle));
}
