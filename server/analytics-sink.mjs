import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const SOURCES = new Set(["web", "multiplayer"]);

export function analyticsLogDirectoryFromEnv(value = process.env.ANALYTICS_LOG_DIR) {
  const directory = String(value ?? "").trim();
  if (!directory) return null;
  if (path.isAbsolute(directory)) return path.resolve(directory);
  throw new TypeError("ANALYTICS_LOG_DIR must be an absolute path");
}

export function createAnalyticsSink(options = {}) {
  const directory = analyticsLogDirectoryFromEnv(options.directory);
  const source = options.source;
  if (!SOURCES.has(source)) throw new TypeError("analytics source is invalid");

  async function write(event, observed = {}) {
    if (!directory) return false;
    const receivedAt = observed.receivedAt ?? new Date().toISOString();
    const date = receivedAt.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new TypeError("analytics timestamp is invalid");
    await mkdir(directory, { recursive: true, mode: 0o750 });
    const record = {
      ...event,
      source,
      receivedAt,
      ip: observed.ip ?? "unknown",
      userAgent: observed.userAgent ?? "",
    };
    await appendFile(path.join(directory, `${source}-${date}.jsonl`), `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o640 });
    return true;
  }

  return { enabled: Boolean(directory), directory, write };
}
