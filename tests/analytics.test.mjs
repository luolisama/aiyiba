import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createMultiplayerAnalyticsEvent,
  isEventWithinRetention,
  parseClientAnalyticsEvent,
  sanitizeAnalyticsUserAgent,
  summarizeAnalyticsEvents,
} from "../app/analytics-model.mjs";
import { createAnalyticsSink } from "../server/analytics-sink.mjs";
import { readAnalyticsEvents } from "../scripts/summarize-analytics.mjs";

function clientEvent(overrides = {}) {
  return {
    schemaVersion: 1,
    event: "game_engaged",
    eventId: "solo-round-1:game_engaged",
    visitorId: "device-12345678",
    sessionId: "session-12345678",
    roundId: "solo-round-1",
    mode: "solo_classic",
    pool: "normal",
    difficulty: "normal",
    ...overrides,
  };
}

function storedEvent(overrides = {}) {
  return {
    ...clientEvent(),
    source: "web",
    receivedAt: "2026-08-28T00:00:00.000Z",
    ip: "203.0.113.10",
    userAgent: "Browser/1",
    outcome: null,
    attempts: null,
    score: null,
    ...overrides,
  };
}

test("analytics validation keeps only the fixed anonymous gameplay schema", () => {
  const parsed = parseClientAnalyticsEvent({ ...clientEvent(), answer: "secret", nickname: "player" });
  assert.deepEqual(parsed, {
    ...clientEvent(),
    outcome: null,
    attempts: null,
    score: null,
  });
  assert.equal("answer" in parsed, false);
  assert.equal("nickname" in parsed, false);
  assert.throws(() => parseClientAnalyticsEvent(clientEvent({ mode: "unknown" })), /mode/);
  assert.throws(() => parseClientAnalyticsEvent(clientEvent({ difficulty: null })), /difficulty/);
  assert.throws(() => parseClientAnalyticsEvent(clientEvent({ event: "game_completed" })), /outcome/);
  assert.equal(sanitizeAnalyticsUserAgent("Browser\u0000\nAgent"), "Browser  Agent");
});

test("multiplayer analytics accepts participant outcomes without protocol data", () => {
  const parsed = createMultiplayerAnalyticsEvent({
    event: "game_completed",
    eventId: "round-12345678:player-12345678:game_completed",
    visitorId: "device-12345678",
    roundId: "round-12345678",
    mode: "multi_clues",
    pool: "hardcore",
    outcome: "win",
    attempts: 3,
  });
  assert.equal(parsed.sessionId, null);
  assert.equal(parsed.difficulty, null);
  assert.equal(parsed.outcome, "win");
  assert.equal("roomCode" in parsed, false);
  assert.equal("playerToken" in parsed, false);
});

test("analytics sink writes source-specific UTC JSONL and can be disabled", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aiyiba-analytics-"));
  try {
    const disabled = createAnalyticsSink({ source: "web", directory: "" });
    assert.equal(disabled.enabled, false);
    assert.equal(await disabled.write(clientEvent()), false);

    const sink = createAnalyticsSink({ source: "web", directory });
    await sink.write(parseClientAnalyticsEvent(clientEvent()), {
      receivedAt: "2026-08-28T12:34:56.000Z",
      ip: "203.0.113.10",
      userAgent: "Browser/1",
    });
    const line = JSON.parse((await readFile(path.join(directory, "web-2026-08-28.jsonl"), "utf8")).trim());
    assert.equal(line.source, "web");
    assert.equal(line.receivedAt, "2026-08-28T12:34:56.000Z");
    assert.equal(line.ip, "203.0.113.10");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("analytics report reader rejects malformed stored events", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aiyiba-analytics-report-"));
  try {
    const sink = createAnalyticsSink({ source: "web", directory });
    await sink.write(parseClientAnalyticsEvent(clientEvent()), {
      receivedAt: "2026-08-28T12:34:56.000Z",
      ip: "203.0.113.10",
      userAgent: "Browser/1",
    });
    const file = path.join(directory, "web-2026-08-28.jsonl");
    await appendFile(file, `${JSON.stringify(storedEvent({ source: "multiplayer" }))}\nnot-json\n`, "utf8");
    const loaded = await readAnalyticsEvents(directory, "2026-08-28", "2026-08-28");
    assert.equal(loaded.events.length, 1);
    assert.equal(loaded.invalidEvents, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("analytics summary deduplicates events and reports funnel quality", () => {
  const events = [
    storedEvent(),
    storedEvent(),
    storedEvent({
      event: "game_completed",
      eventId: "solo-round-1:game_completed",
      receivedAt: "2026-08-28T00:01:00.000Z",
      outcome: "win",
      attempts: 2,
    }),
    storedEvent({
      event: "replay_requested",
      eventId: "solo-round-1:replay_requested",
      receivedAt: "2026-08-28T00:01:10.000Z",
    }),
    storedEvent({
      event: "game_engaged",
      eventId: "solo-round-2:game_engaged",
      roundId: "solo-round-2",
      receivedAt: "2026-08-28T00:01:20.000Z",
    }),
    storedEvent({
      event: "game_completed",
      eventId: "orphan-round:game_completed",
      roundId: "orphan-round",
      visitorId: "device-87654321",
      sessionId: "session-87654321",
      receivedAt: "2026-08-28T00:02:00.000Z",
      outcome: "loss",
      attempts: 6,
    }),
  ];
  const summary = summarizeAnalyticsEvents(events, { from: "2026-08-28", to: "2026-08-28", invalidEvents: 2 });
  assert.equal(summary.uniqueDevices, 2);
  assert.equal(summary.engagedDevices, 1);
  assert.equal(summary.engagedRounds, 2);
  assert.equal(summary.completedRounds, 2);
  assert.equal(summary.duplicateEvents, 1);
  assert.equal(summary.orphanCompletions, 1);
  assert.equal(summary.replayDevices, 1);
  assert.equal(summary.durationMs.median, 60_000);
  assert.equal(summary.invalidEvents, 2);
});

test("analytics retention includes the exact 90-day boundary", () => {
  const now = Date.parse("2026-08-28T12:00:00.000Z");
  assert.equal(isEventWithinRetention("2026-05-30T12:00:00.000Z", now), true);
  assert.equal(isEventWithinRetention("2026-05-30T11:59:59.999Z", now), false);
  assert.equal(isEventWithinRetention("invalid", now), false);
});
