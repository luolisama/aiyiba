const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

function parseDateKey(dateKey) {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) throw new Error(`Invalid date key: ${dateKey}`);
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (!validUtcDate(parts.year, parts.month, parts.day)) throw new Error(`Invalid date key: ${dateKey}`);
  return parts;
}

function validUtcDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function occurrenceOnOrAfter(today, month, day) {
  const todayStamp = Date.UTC(today.year, today.month - 1, today.day);
  for (let year = today.year; year <= today.year + 8; year += 1) {
    if (!validUtcDate(year, month, day)) continue;
    const stamp = Date.UTC(year, month - 1, day);
    if (stamp >= todayStamp) return { year, month, day, stamp };
  }
  throw new Error("Unable to resolve the next anniversary date.");
}

function pad(value) {
  return String(value).padStart(2, "0");
}

export function dateKeyInTimeZone(date = new Date(), timeZone = "Asia/Shanghai") {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function findAnniversarySpotlight(songs, todayKey) {
  const today = parseDateKey(todayKey);
  const todayStamp = Date.UTC(today.year, today.month - 1, today.day);
  const candidates = songs.map((song) => {
    const published = parseDateKey(song.publicationDate);
    const occurrence = occurrenceOnOrAfter(today, published.month, published.day);
    return {
      ...song,
      anniversaryYears: occurrence.year - published.year,
      daysUntil: Math.round((occurrence.stamp - todayStamp) / 86_400_000),
      occurrenceDate: `${occurrence.year}-${pad(occurrence.month)}-${pad(occurrence.day)}`,
    };
  }).filter((song) => song.anniversaryYears >= 0);

  if (!candidates.length) return null;
  const daysUntil = Math.min(...candidates.map((song) => song.daysUntil));
  const matches = candidates
    .filter((song) => song.daysUntil === daysUntil)
    .sort((left, right) => left.publicationDate.localeCompare(right.publicationDate) || left.name.localeCompare(right.name, "zh-CN"));

  return {
    kind: daysUntil === 0 ? "today" : "upcoming",
    daysUntil,
    occurrenceDate: matches[0].occurrenceDate,
    songs: matches,
  };
}
