export const ANALYTICS_SCHEMA_VERSION = 1;
export const ANALYTICS_RETENTION_DAYS = 90;

export const ANALYTICS_EVENTS = new Set([
  "game_engaged",
  "game_completed",
  "replay_requested",
]);

export const ANALYTICS_MODES = new Set([
  "solo_classic",
  "solo_clues",
  "timeline",
  "multi_classic",
  "multi_clues",
]);

export const ANALYTICS_POOLS = new Set(["normal", "hardcore"]);
export const ANALYTICS_DIFFICULTIES = new Set(["normal", "hard"]);
export const ANALYTICS_OUTCOMES = new Set(["win", "loss", "draw", "surrender", "completed"]);

const CLIENT_MODES = new Set(["solo_classic", "solo_clues", "timeline"]);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/u;

function identifier(value, name, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a safe identifier`);
  }
  return value;
}

function enumValue(value, allowed, name, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "string" || !allowed.has(value)) throw new TypeError(`${name} is invalid`);
  return value;
}

function boundedInteger(value, name, minimum, maximum) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

export function parseClientAnalyticsEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("event body must be an object");
  if (value.schemaVersion !== ANALYTICS_SCHEMA_VERSION) throw new TypeError("schemaVersion is invalid");

  const event = enumValue(value.event, ANALYTICS_EVENTS, "event");
  const mode = enumValue(value.mode, CLIENT_MODES, "mode");
  const pool = enumValue(value.pool, ANALYTICS_POOLS, "pool");
  const difficulty = enumValue(value.difficulty, ANALYTICS_DIFFICULTIES, "difficulty", { optional: true });
  const outcome = enumValue(value.outcome, ANALYTICS_OUTCOMES, "outcome", { optional: true });

  if (mode === "solo_classic" && !difficulty) throw new TypeError("solo classic events require difficulty");
  if (mode !== "solo_classic" && difficulty) throw new TypeError("difficulty is only valid for classic mode");
  if (event === "game_completed" && !outcome) throw new TypeError("completed events require outcome");
  if (event !== "game_completed" && outcome) throw new TypeError("outcome is only valid for completed events");
  const attempts = boundedInteger(value.attempts, "attempts", 0, 100);
  const score = boundedInteger(value.score, "score", 0, 100);
  if (event !== "game_completed" && attempts !== null) throw new TypeError("attempts is only valid for completed events");
  if ((event !== "game_completed" || mode !== "timeline") && score !== null) {
    throw new TypeError("score is only valid for completed timeline events");
  }

  return {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    event,
    eventId: identifier(value.eventId, "eventId"),
    visitorId: identifier(value.visitorId, "visitorId"),
    sessionId: identifier(value.sessionId, "sessionId"),
    roundId: identifier(value.roundId, "roundId"),
    mode,
    pool,
    difficulty,
    outcome,
    attempts,
    score,
  };
}

export function createMultiplayerAnalyticsEvent(value) {
  const event = enumValue(value.event, ANALYTICS_EVENTS, "event");
  const mode = enumValue(value.mode, new Set(["multi_classic", "multi_clues"]), "mode");
  const difficulty = enumValue(value.difficulty, ANALYTICS_DIFFICULTIES, "difficulty", { optional: true });
  if (mode === "multi_classic" && !difficulty) throw new TypeError("multiplayer classic events require difficulty");
  if (mode === "multi_clues" && difficulty) throw new TypeError("difficulty is not valid for multiplayer clues");
  const outcome = enumValue(value.outcome, ANALYTICS_OUTCOMES, "outcome", { optional: true });
  if (event === "game_completed" && !outcome) throw new TypeError("completed events require outcome");
  if (event !== "game_completed" && outcome) throw new TypeError("outcome is only valid for completed events");
  const attempts = boundedInteger(value.attempts, "attempts", 0, 100);
  if (event !== "game_completed" && attempts !== null) throw new TypeError("attempts is only valid for completed events");
  return {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    event,
    eventId: identifier(value.eventId, "eventId"),
    visitorId: identifier(value.visitorId, "visitorId"),
    sessionId: null,
    roundId: identifier(value.roundId, "roundId"),
    mode,
    pool: enumValue(value.pool, ANALYTICS_POOLS, "pool"),
    difficulty,
    outcome,
    attempts,
    score: null,
  };
}

export function sanitizeAnalyticsUserAgent(value) {
  // eslint-disable-next-line no-control-regex -- control bytes must never enter the private JSONL log
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 256);
}

export function sanitizeAnalyticsIp(value) {
  return String(value ?? "unknown").replace(/[^0-9A-Fa-f:.,]/gu, "").split(",")[0].slice(0, 64) || "unknown";
}

export function isEventWithinRetention(receivedAt, now = Date.now(), retentionDays = ANALYTICS_RETENTION_DAYS) {
  const timestamp = Date.parse(receivedAt);
  if (!Number.isFinite(timestamp)) return false;
  return timestamp >= now - retentionDays * 24 * 60 * 60 * 1_000;
}

function increment(target, key) {
  if (!key) return;
  target[key] = (target[key] ?? 0) + 1;
}

function rounded(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

export function summarizeAnalyticsEvents(events, options = {}) {
  const seenEventKeys = new Set();
  const visitors = new Set();
  const sessions = new Set();
  const ipUserAgents = new Set();
  const engagedVisitors = new Set();
  const replayVisitors = new Set();
  const engagedByVisitor = new Map();
  const engagedByRound = new Map();
  const modes = {};
  const pools = {};
  const difficulties = {};
  const outcomes = {};
  const sources = {};
  const durations = [];
  const attempts = [];
  const timelineScores = [];
  const multiplayerRounds = new Set();
  let engaged = 0;
  let completed = 0;
  let replayRequests = 0;
  let duplicateEvents = 0;
  let orphanCompletions = 0;
  let multiplayerPlayerRounds = 0;

  const sortedEvents = [...events].sort((left, right) => Date.parse(left.receivedAt) - Date.parse(right.receivedAt));
  for (const item of sortedEvents) {
    const eventKey = `${item.visitorId}:${item.eventId}`;
    if (seenEventKeys.has(eventKey)) {
      duplicateEvents += 1;
      continue;
    }
    seenEventKeys.add(eventKey);
    visitors.add(item.visitorId);
    if (item.sessionId) sessions.add(item.sessionId);
    if (item.ip && item.userAgent) ipUserAgents.add(`${item.ip}\n${item.userAgent}`);
    increment(sources, item.source);

    const roundKey = `${item.visitorId}:${item.roundId}`;
    if (item.event === "game_engaged") {
      engaged += 1;
      engagedVisitors.add(item.visitorId);
      engagedByRound.set(roundKey, Date.parse(item.receivedAt));
      engagedByVisitor.set(item.visitorId, (engagedByVisitor.get(item.visitorId) ?? 0) + 1);
      increment(modes, item.mode);
      increment(pools, item.pool);
      increment(difficulties, item.difficulty);
      if (item.mode?.startsWith("multi_")) {
        multiplayerRounds.add(item.roundId);
        multiplayerPlayerRounds += 1;
      }
    } else if (item.event === "game_completed") {
      completed += 1;
      increment(outcomes, item.outcome);
      if (Number.isInteger(item.attempts)) attempts.push(item.attempts);
      if (item.mode === "timeline" && Number.isInteger(item.score)) timelineScores.push(item.score);
      const startedAt = engagedByRound.get(roundKey);
      const completedAt = Date.parse(item.receivedAt);
      if (Number.isFinite(startedAt) && completedAt >= startedAt) durations.push(completedAt - startedAt);
      else orphanCompletions += 1;
    } else if (item.event === "replay_requested") {
      replayRequests += 1;
      replayVisitors.add(item.visitorId);
    }
  }

  for (const [visitorId, count] of engagedByVisitor) {
    if (count >= 2) replayVisitors.add(visitorId);
  }

  durations.sort((left, right) => left - right);
  const engagedVisitorCount = engagedVisitors.size;
  return {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    range: { from: options.from ?? null, to: options.to ?? null },
    uniqueDevices: visitors.size,
    engagedDevices: engagedVisitorCount,
    uniqueSessions: sessions.size,
    uniqueIpUserAgents: ipUserAgents.size,
    engagedRounds: engaged,
    completedRounds: completed,
    completionRate: engaged ? rounded((completed - orphanCompletions) / engaged) : null,
    replayRequests,
    replayDevices: replayVisitors.size,
    replayRate: engagedVisitorCount ? rounded(replayVisitors.size / engagedVisitorCount) : null,
    byMode: modes,
    byPool: pools,
    byDifficulty: difficulties,
    byOutcome: outcomes,
    bySource: sources,
    averageAttempts: attempts.length ? rounded(attempts.reduce((sum, value) => sum + value, 0) / attempts.length) : null,
    averageTimelineScore: timelineScores.length ? rounded(timelineScores.reduce((sum, value) => sum + value, 0) / timelineScores.length) : null,
    durationMs: {
      samples: durations.length,
      median: percentile(durations, 0.5),
      p90: percentile(durations, 0.9),
    },
    multiplayerRoomRounds: multiplayerRounds.size,
    multiplayerPlayerRounds,
    duplicateEvents,
    orphanCompletions,
    invalidEvents: options.invalidEvents ?? 0,
  };
}
