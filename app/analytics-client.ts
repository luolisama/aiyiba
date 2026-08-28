const DEVICE_STORAGE_KEY = "aiyiba-pk-device-v1";
const SESSION_STORAGE_KEY = "aiyiba-analytics-session-v1";
let fallbackDeviceId = "";
let fallbackSessionId = "";
let sendChain = Promise.resolve();

type AnalyticsMode = "solo_classic" | "solo_clues" | "timeline";
type AnalyticsPool = "normal" | "hardcore";
type AnalyticsDifficulty = "normal" | "hard";
type AnalyticsOutcome = "win" | "loss" | "surrender" | "completed";

type AnalyticsEvent = {
  event: "game_engaged" | "game_completed" | "replay_requested";
  roundId: string;
  mode: AnalyticsMode;
  pool: AnalyticsPool;
  difficulty?: AnalyticsDifficulty;
  outcome?: AnalyticsOutcome;
  attempts?: number;
  score?: number;
};

function randomId(prefix: string) {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function readAnonymousDeviceId() {
  if (fallbackDeviceId) return fallbackDeviceId;
  try {
    const existing = localStorage.getItem(DEVICE_STORAGE_KEY)?.trim();
    if (existing) return (fallbackDeviceId = existing);
    const created = randomId("device");
    localStorage.setItem(DEVICE_STORAGE_KEY, created);
    return (fallbackDeviceId = created);
  } catch {
    return (fallbackDeviceId ||= randomId("device"));
  }
}

function readAnalyticsSessionId() {
  if (fallbackSessionId) return fallbackSessionId;
  try {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY)?.trim();
    if (existing) return (fallbackSessionId = existing);
    const created = randomId("session");
    sessionStorage.setItem(SESSION_STORAGE_KEY, created);
    return (fallbackSessionId = created);
  } catch {
    return (fallbackSessionId ||= randomId("session"));
  }
}

export function analyticsEventPayload(input: AnalyticsEvent) {
  return {
    schemaVersion: 1,
    ...input,
    eventId: `${input.roundId}:${input.event}`,
    visitorId: readAnonymousDeviceId(),
    sessionId: readAnalyticsSessionId(),
  };
}

export function trackGameEvent(input: AnalyticsEvent) {
  let payload: ReturnType<typeof analyticsEventPayload>;
  try {
    payload = analyticsEventPayload(input);
  } catch {
    return;
  }
  sendChain = sendChain
    .catch(() => undefined)
    .then(async () => {
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(() => controller.abort(), 3_000);
      try {
        await fetch("/api/analytics", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
          signal: controller.signal,
        });
      } catch {
        // Analytics must never block or change gameplay.
      } finally {
        globalThis.clearTimeout(timeout);
      }
    });
}
