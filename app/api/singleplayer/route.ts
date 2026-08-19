import hardcoreSongsJson from "../../data/hardcore-songs.json";
import songsJson from "../../data/songs.json";
import { createSinglePlayerManager } from "../../../server/singleplayer-game.mjs";
import { createRequestRateLimiter } from "../../../server/request-rate-limiter.mjs";

const manager = createSinglePlayerManager({
  normal: songsJson,
  hardcore: hardcoreSongsJson,
});

const REQUEST_WINDOW_MS = 60_000;
const REQUESTS_PER_WINDOW = 180;
const STARTS_PER_WINDOW = 12;
const MAX_BODY_BYTES = 16 * 1024;
const requestLimiter = createRequestRateLimiter({ windowMs: REQUEST_WINDOW_MS, limit: REQUESTS_PER_WINDOW, maxEntries: 4_096 });
const startLimiter = createRequestRateLimiter({ windowMs: REQUEST_WINDOW_MS, limit: STARTS_PER_WINDOW, maxEntries: 4_096 });

function getClientKey(request: Request) {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

function originAllowed(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const fallbackOrigins = process.env.NODE_ENV === "production"
    ? "https://aiyiba.getuphole.top"
    : "https://aiyiba.getuphole.top,http://localhost:3000,http://127.0.0.1:3000";
  const configured = (process.env.PK_ALLOWED_ORIGINS ?? fallbackOrigins)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.includes(origin);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    const candidate = error as Error & { status?: number; code?: string };
    return {
      message: error.message,
      status: Number.isInteger(candidate.status) ? candidate.status : 400,
      code: candidate.code ?? "bad_request",
    };
  }
  return { message: "请求失败", status: 400, code: "bad_request" };
}

export async function POST(request: Request) {
  if (!originAllowed(request)) return json({ error: "请求来源不受支持", code: "origin_denied" }, 403);
  const clientKey = getClientKey(request);
  if (!requestLimiter.consume(clientKey)) return json({ error: "请求过于频繁，请稍后再试", code: "rate_limited" }, 429);
  manager.cleanup();

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return json({ error: "请求过大", code: "body_too_large" }, 413);

  let message: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ error: "请求过大", code: "body_too_large" }, 413);
    message = JSON.parse(raw);
  } catch {
    return json({ error: "无效请求", code: "invalid_json" }, 400);
  }

  if (!message || typeof message !== "object" || typeof (message as { action?: unknown }).action !== "string") {
    return json({ error: "无效请求", code: "invalid_request" }, 400);
  }

  const payload = message as {
    action: string;
    pool?: string;
    mode?: string;
    clientId?: string;
    roundId?: string;
    bvid?: string;
  };

  try {
    switch (payload.action) {
      case "start":
        if (!startLimiter.consume(clientKey)) return json({ error: "新游戏开启得太频繁，请稍后再试", code: "start_rate_limited" }, 429);
        return json({ state: manager.start(payload.pool, payload.mode, payload.clientId ?? null, clientKey) });
      case "resume":
        return json({ state: manager.resume(payload.roundId) });
      case "guess": {
        const result = manager.guess(payload.roundId, payload.bvid ?? "");
        return json({ state: result.state, result: result.result });
      }
      case "surrender":
        return json({ state: manager.surrender(payload.roundId) });
      case "reset-pool":
        return json(manager.resetPool(payload.pool, payload.clientId));
      default:
        return json({ error: "不支持的操作", code: "unsupported_action" }, 400);
    }
  } catch (error) {
    const details = errorDetails(error);
    return json({ error: details.message, code: details.code }, details.status);
  }
}
