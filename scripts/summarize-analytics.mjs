import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createMultiplayerAnalyticsEvent,
  parseClientAnalyticsEvent,
  sanitizeAnalyticsIp,
  sanitizeAnalyticsUserAgent,
  summarizeAnalyticsEvents,
} from "../app/analytics-model.mjs";

function argumentsFrom(argv) {
  const result = { directory: "", from: "", to: "", format: "json" };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === "--dir") {
      result.directory = value;
      index += 1;
    } else if (name === "--from") {
      result.from = value;
      index += 1;
    } else if (name === "--to") {
      result.to = value;
      index += 1;
    } else if (name === "--format") {
      result.format = value;
      index += 1;
    }
    else throw new Error(`Unknown argument: ${name}`);
  }
  if (!result.directory || !path.isAbsolute(result.directory)) throw new Error("--dir must be an absolute path");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(result.from) || !/^\d{4}-\d{2}-\d{2}$/u.test(result.to)) {
    throw new Error("--from and --to must use YYYY-MM-DD");
  }
  if (result.from > result.to) throw new Error("--from must not be after --to");
  if (!new Set(["json", "markdown"]).has(result.format)) throw new Error("--format must be json or markdown");
  return result;
}

function normalizeStoredEvent(value, from, to, expectedSource) {
  const day = typeof value?.receivedAt === "string" ? value.receivedAt.slice(0, 10) : "";
  if (value?.source !== expectedSource || !Number.isFinite(Date.parse(value.receivedAt)) || day < from || day > to) {
    throw new TypeError("stored event metadata is invalid");
  }
  const event = expectedSource === "web"
    ? parseClientAnalyticsEvent(value)
    : createMultiplayerAnalyticsEvent(value);
  return {
    ...event,
    source: expectedSource,
    receivedAt: value.receivedAt,
    ip: sanitizeAnalyticsIp(value.ip),
    userAgent: sanitizeAnalyticsUserAgent(value.userAgent),
  };
}

export async function readAnalyticsEvents(directory, from, to) {
  const events = [];
  let invalidEvents = 0;
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^(web|multiplayer)-\d{4}-\d{2}-\d{2}\.jsonl$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    const source = name.startsWith("web-") ? "web" : "multiplayer";
    const day = name.slice(name.indexOf("-") + 1, -".jsonl".length);
    if (day < from || day > to) continue;
    const lines = (await readFile(path.join(directory, name), "utf8")).split(/\r?\n/u).filter(Boolean);
    for (const line of lines) {
      try {
        const value = JSON.parse(line);
        events.push(normalizeStoredEvent(value, from, to, source));
      } catch {
        invalidEvents += 1;
      }
    }
  }
  return { events, invalidEvents };
}

function percentage(value) {
  return value === null ? "—" : `${Math.round(value * 1000) / 10}%`;
}

export function analyticsSummaryMarkdown(summary) {
  const rows = [
    ["实际参与设备", summary.engagedDevices],
    ["实际开局", summary.engagedRounds],
    ["完成局数", summary.completedRounds],
    ["完成率", percentage(summary.completionRate)],
    ["复玩设备", summary.replayDevices],
    ["复玩率", percentage(summary.replayRate)],
    ["事件 IP+UA", summary.uniqueIpUserAgents],
    ["多人房间局", summary.multiplayerRoomRounds],
    ["多人玩家参与局", summary.multiplayerPlayerRounds],
  ];
  return [
    `# 哎一把匿名玩法统计（${summary.range.from} 至 ${summary.range.to}）`,
    "",
    "| 指标 | 数值 |",
    "| --- | ---: |",
    ...rows.map(([label, value]) => `| ${label} | ${value} |`),
    "",
    `- 玩法：${JSON.stringify(summary.byMode)}`,
    `- 题库：${JSON.stringify(summary.byPool)}`,
    `- 结果：${JSON.stringify(summary.byOutcome)}`,
    `- 平均尝试：${summary.averageAttempts ?? "—"}`,
    `- 时光机平均得分：${summary.averageTimelineScore ?? "—"}`,
    `- 完成耗时：中位数 ${summary.durationMs.median ?? "—"} ms，P90 ${summary.durationMs.p90 ?? "—"} ms（${summary.durationMs.samples} 个样本）`,
    `- 数据质量：重复 ${summary.duplicateEvents}，孤立完成 ${summary.orphanCompletions}，无效 ${summary.invalidEvents}`,
    "",
    "> 独立设备和 IP+UA 均为近似口径，不等同于独立自然人。",
  ].join("\n");
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const loaded = await readAnalyticsEvents(options.directory, options.from, options.to);
  const summary = summarizeAnalyticsEvents(loaded.events, {
    from: options.from,
    to: options.to,
    invalidEvents: loaded.invalidEvents,
  });
  process.stdout.write(options.format === "markdown" ? `${analyticsSummaryMarkdown(summary)}\n` : `${JSON.stringify(summary, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
