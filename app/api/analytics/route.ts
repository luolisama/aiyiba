import { createRequestRateLimiter } from "../../../server/request-rate-limiter.mjs";
import {
  parseClientAnalyticsEvent,
  sanitizeAnalyticsIp,
  sanitizeAnalyticsUserAgent,
} from "../../analytics-model.mjs";
import { siteOriginFromEnv } from "../../site-origin.mjs";

const MAX_BODY_BYTES = 4 * 1024;
const visitorLimiter = createRequestRateLimiter({ windowMs: 60_000, limit: 30, maxEntries: 10_000 });
const sourceLimiter = createRequestRateLimiter({ windowMs: 60_000, limit: 120, maxEntries: 5_000 });
const globalLimiter = createRequestRateLimiter({ windowMs: 60_000, limit: 3_000, maxEntries: 1 });
const siteOrigin = siteOriginFromEnv(process.env.SITE_ORIGIN);
const trustProxy = /^(1|true)$/iu.test(process.env.ANALYTICS_TRUST_PROXY ?? "");
const ingestUrl = (process.env.ANALYTICS_INGEST_URL ?? "").trim();
if (ingestUrl && !/^http:\/\/127\.0\.0\.1:[0-9]+\/analytics$/u.test(ingestUrl)) {
  throw new TypeError("ANALYTICS_INGEST_URL must be a loopback analytics endpoint");
}

function jsonResponse(status: number, code: string) {
  return new Response(JSON.stringify({ code }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function readLimitedBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new RangeError("body_too_large");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError("body_too_large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

function observedIp(request: Request) {
  if (!trustProxy) return "unknown";
  return sanitizeAnalyticsIp(request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for"));
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== siteOrigin) return jsonResponse(403, "origin_rejected");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return jsonResponse(400, "invalid_content_type");
  }

  let event;
  try {
    const body = await readLimitedBody(request);
    event = parseClientAnalyticsEvent(JSON.parse(body));
  } catch (error) {
    if (error instanceof RangeError) return jsonResponse(413, "body_too_large");
    return jsonResponse(400, "invalid_event");
  }
  if (!ingestUrl) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  const sourceIp = observedIp(request);
  if (!globalLimiter.consume("all")
    || (sourceIp !== "unknown" && !sourceLimiter.consume(sourceIp))
    || !visitorLimiter.consume(event.visitorId)) {
    return jsonResponse(429, "rate_limited");
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(ingestUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event,
        observed: {
          ip: observedIp(request),
          userAgent: sanitizeAnalyticsUserAgent(request.headers.get("user-agent")),
        },
      }),
      signal: controller.signal,
    });
    if (response.status !== 202) throw new Error("analytics ingest rejected the event");
    return jsonResponse(202, "accepted");
  } catch {
    return jsonResponse(500, "write_failed");
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function GET() {
  return jsonResponse(405, "method_not_allowed");
}
