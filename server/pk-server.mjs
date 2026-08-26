import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import {
  createPkManager,
  PK_ABSOLUTE_ROOM_TTL_MS,
  PK_GUESS_INTERVAL_MS,
  PK_MAX_ROOMS,
  PK_START_GRACE_MS,
} from "./pk-game.mjs";
import { ROUND_INVALIDATED_MESSAGE } from "../app/round-errors.mjs";
import { multiplayerAllowedOriginsFromEnv, siteOriginFromEnv } from "../app/site-origin.mjs";

const catalog = JSON.parse(await readFile(new URL("../app/data/songs.json", import.meta.url), "utf8"));
const hardcoreCatalog = JSON.parse(await readFile(new URL("../app/data/hardcore-songs.json", import.meta.url), "utf8"));
const configuredPort = Number(process.env.PK_PORT ?? 3001);
const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort < 65_536 ? configuredPort : 3001;
const host = process.env.PK_HOST ?? "127.0.0.1";
const siteOrigin = siteOriginFromEnv(process.env.SITE_ORIGIN);
const configuredMaxConnections = Number(process.env.PK_MAX_CONNECTIONS ?? 200);
const maxConnections = Number.isInteger(configuredMaxConnections) && configuredMaxConnections > 0 ? configuredMaxConnections : 200;
const configuredMaxConnectionsPerIp = Number(process.env.PK_MAX_CONNECTIONS_PER_IP ?? 24);
const maxConnectionsPerIp = Number.isInteger(configuredMaxConnectionsPerIp) && configuredMaxConnectionsPerIp > 0
  ? configuredMaxConnectionsPerIp
  : 24;
const configuredMaxRooms = Number(process.env.PK_MAX_ROOMS ?? PK_MAX_ROOMS);
const maxRooms = Number.isInteger(configuredMaxRooms) && configuredMaxRooms > 0 ? configuredMaxRooms : PK_MAX_ROOMS;
const configuredMaxActiveRoomsPerIp = Number(process.env.PK_MAX_ACTIVE_ROOMS_PER_IP ?? 3);
const maxActiveRoomsPerIp = Number.isInteger(configuredMaxActiveRoomsPerIp) && configuredMaxActiveRoomsPerIp > 0
  ? configuredMaxActiveRoomsPerIp
  : 3;
const configuredMaxActivePlayerSeatsPerIp = Number(process.env.PK_MAX_ACTIVE_PLAYER_SEATS_PER_IP ?? 8);
const maxActivePlayerSeatsPerIp = Number.isInteger(configuredMaxActivePlayerSeatsPerIp) && configuredMaxActivePlayerSeatsPerIp > 0
  ? configuredMaxActivePlayerSeatsPerIp
  : 8;
const configuredRoomCreateWindowMs = Number(process.env.PK_ROOM_CREATE_WINDOW_MS ?? 10 * 60 * 1_000);
const roomCreateWindowMs = Number.isInteger(configuredRoomCreateWindowMs) && configuredRoomCreateWindowMs >= 60_000
  ? configuredRoomCreateWindowMs
  : 10 * 60 * 1_000;
const configuredMaxRoomCreatesPerWindow = Number(process.env.PK_MAX_ROOM_CREATES_PER_WINDOW ?? 6);
const maxRoomCreatesPerWindow = Number.isInteger(configuredMaxRoomCreatesPerWindow) && configuredMaxRoomCreatesPerWindow > 0
  ? configuredMaxRoomCreatesPerWindow
  : 6;
const configuredDisconnectGraceMs = Number(process.env.PK_DISCONNECT_GRACE_MS ?? 20_000);
const disconnectGraceMs = Number.isInteger(configuredDisconnectGraceMs) && configuredDisconnectGraceMs >= 100
  ? configuredDisconnectGraceMs
  : 20_000;
const configuredCountdownMs = Number(process.env.PK_COUNTDOWN_MS ?? 3_000);
const countdownMs = Number.isInteger(configuredCountdownMs) && configuredCountdownMs >= 0 ? configuredCountdownMs : 3_000;
const configuredRoomTtlMs = Number(process.env.PK_ROOM_TTL_MS ?? 30 * 60 * 1_000);
const roomTtlMs = Number.isInteger(configuredRoomTtlMs) && configuredRoomTtlMs >= 1_000 ? configuredRoomTtlMs : 30 * 60 * 1_000;
const configuredLobbyRoomTtlMs = Number(process.env.PK_LOBBY_ROOM_TTL_MS ?? 10 * 60 * 1_000);
const lobbyRoomTtlMs = Number.isInteger(configuredLobbyRoomTtlMs) && configuredLobbyRoomTtlMs >= 60_000
  ? configuredLobbyRoomTtlMs
  : 10 * 60 * 1_000;
const configuredAbsoluteRoomTtlMs = Number(process.env.PK_ABSOLUTE_ROOM_TTL_MS ?? PK_ABSOLUTE_ROOM_TTL_MS);
const absoluteRoomTtlMs = Number.isInteger(configuredAbsoluteRoomTtlMs) && configuredAbsoluteRoomTtlMs >= 60_000
  ? configuredAbsoluteRoomTtlMs
  : PK_ABSOLUTE_ROOM_TTL_MS;
const configuredGuessIntervalMs = Number(process.env.PK_GUESS_INTERVAL_MS ?? PK_GUESS_INTERVAL_MS);
const guessIntervalMs = Number.isInteger(configuredGuessIntervalMs) && configuredGuessIntervalMs >= 0
  ? configuredGuessIntervalMs
  : PK_GUESS_INTERVAL_MS;
const configuredStartGraceMs = Number(process.env.PK_START_GRACE_MS ?? PK_START_GRACE_MS);
const startGraceMs = Number.isInteger(configuredStartGraceMs) && configuredStartGraceMs >= 0
  ? configuredStartGraceMs
  : PK_START_GRACE_MS;
const configuredJoinAttemptsPerWindow = Number(process.env.PK_JOIN_ATTEMPTS_PER_WINDOW ?? 20);
const joinAttemptsPerWindow = Number.isInteger(configuredJoinAttemptsPerWindow) && configuredJoinAttemptsPerWindow > 0
  ? configuredJoinAttemptsPerWindow
  : 20;
const joinAttemptWindowMs = 60_000;
const configuredMetricsIntervalMs = Number(process.env.PK_METRICS_INTERVAL_MS ?? 60_000);
const metricsIntervalMs = Number.isInteger(configuredMetricsIntervalMs) && configuredMetricsIntervalMs >= 1_000
  ? configuredMetricsIntervalMs
  : 60_000;
const configuredConnectionAlertRatio = Number(process.env.PK_CONNECTION_ALERT_RATIO ?? 0.8);
const connectionAlertRatio = Number.isFinite(configuredConnectionAlertRatio) && configuredConnectionAlertRatio > 0 && configuredConnectionAlertRatio <= 1
  ? configuredConnectionAlertRatio
  : 0.8;
const configuredRoomAlertRatio = Number(process.env.PK_ROOM_ALERT_RATIO ?? 0.8);
const roomAlertRatio = Number.isFinite(configuredRoomAlertRatio) && configuredRoomAlertRatio > 0 && configuredRoomAlertRatio <= 1
  ? configuredRoomAlertRatio
  : 0.8;
const messageWindowMs = 10_000;
const maxMessagesPerWindow = 40;
const heartbeatMs = 30_000;
const allowedOrigins = new Set(multiplayerAllowedOriginsFromEnv(process.env.PK_ALLOWED_ORIGINS, siteOrigin));
const countdownTimers = new Map();
const clueStageTimers = new Map();
const disconnectTimers = new Map();
const sockets = new Map();
const contexts = new Map();
const clientConnectionCounts = new Map();
const activeRoomsByClient = new Map();
const activePlayerSeatsByClient = new Map();
const playerClients = new Map();
const roomClients = new Map();
const roomCreateHistoryByClient = new Map();
const joinAttemptHistoryByClient = new Map();
const manager = createPkManager({ normal: catalog, hardcore: hardcoreCatalog }, {
  maxRooms,
  countdownMs,
  roomTtlMs,
  lobbyRoomTtlMs,
  absoluteRoomTtlMs,
  guessIntervalMs,
  startGraceMs,
});
const lobbySubscribers = new Set();
let lobbyBroadcastTimer = null;
let draining = false;
let maintenanceStartedAt = null;
let rejectedConnections = 0;
let rejectedMessages = 0;
let blockedRoomCreations = 0;
const metricAlertState = new Map();

function logPk(event, data = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: "aiyiba-pk", event, ...data }));
}

const healthServer = createServer((request, response) => {
  if (request.method === "POST" && request.url === "/drain") {
    beginDrain();
    response.writeHead(202, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify({ status: "draining", roomCount: manager.roomCount() }));
    return;
  }
  if (request.method === "POST" && request.url === "/resume") {
    resumeFromDrain();
    response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify({ status: draining ? "draining" : "ok", roomCount: manager.roomCount() }));
    return;
  }
  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(draining ? 503 : 200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify({
      status: draining ? "draining" : "ok",
      roomCount: manager.roomCount(),
      activeConnections: wss.clients.size,
      maxRooms,
      draining,
      maintenanceStartedAt,
    }));
    return;
  }
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("not found");
});

const wss = new WebSocketServer({
  server: healthServer,
  maxPayload: 16 * 1024,
  perMessageDeflate: false,
  verifyClient: ({ origin, req }) => {
    if (!origin || !allowedOrigins.has(origin)) {
      rejectedConnections += 1;
      return false;
    }
    if (draining || (clientConnectionCounts.get(getClientKey(req)) ?? 0) >= maxConnectionsPerIp) {
      rejectedConnections += 1;
      return false;
    }
    return true;
  },
});

function getClientKey(request) {
  // Nginx overwrites X-Real-IP with the address it observed before proxying.
  // Prefer it so all tabs behind one public address share the same limit.
  const realIp = request?.headers?.["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) return realIp.trim();
  const forwarded = request?.headers?.["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const firstForwarded = typeof forwardedValue === "string" ? forwardedValue.split(",")[0].trim() : "";
  return firstForwarded || request?.socket?.remoteAddress || "unknown";
}

function incrementClientConnection(clientKey) {
  clientConnectionCounts.set(clientKey, (clientConnectionCounts.get(clientKey) ?? 0) + 1);
}

function decrementClientConnection(clientKey) {
  const next = (clientConnectionCounts.get(clientKey) ?? 1) - 1;
  if (next > 0) clientConnectionCounts.set(clientKey, next);
  else clientConnectionCounts.delete(clientKey);
}

function roomCreationHistory(clientKey) {
  const cutoff = Date.now() - roomCreateWindowMs;
  const history = (roomCreateHistoryByClient.get(clientKey) ?? []).filter((timestamp) => timestamp > cutoff);
  if (history.length) roomCreateHistoryByClient.set(clientKey, history);
  else roomCreateHistoryByClient.delete(clientKey);
  return history;
}

function assertRoomCreationAllowed(clientKey) {
  const activeRooms = activeRoomsByClient.get(clientKey) ?? 0;
  if (activeRooms >= maxActiveRoomsPerIp) {
    blockedRoomCreations += 1;
    throw new Error("这个网络创建的多人房间太多了，请先结束已有房间");
  }
  const history = roomCreationHistory(clientKey);
  if (history.length >= maxRoomCreatesPerWindow) {
    blockedRoomCreations += 1;
    throw new Error("创建房间太频繁，请稍后再试");
  }
}

function assertPlayerSeatAllowed(clientKey) {
  const seats = activePlayerSeatsByClient.get(clientKey) ?? 0;
  if (seats >= maxActivePlayerSeatsPerIp) throw new Error("这个网络同时参赛人数太多了，请先结束已有房间");
}

function trackPlayerSeat(playerId, clientKey) {
  playerClients.set(playerId, clientKey);
  activePlayerSeatsByClient.set(clientKey, (activePlayerSeatsByClient.get(clientKey) ?? 0) + 1);
}

function releasePlayerSeat(playerId) {
  const clientKey = playerClients.get(playerId);
  if (!clientKey) return;
  playerClients.delete(playerId);
  const next = (activePlayerSeatsByClient.get(clientKey) ?? 1) - 1;
  if (next > 0) activePlayerSeatsByClient.set(clientKey, next);
  else activePlayerSeatsByClient.delete(clientKey);
}

function assertJoinAttemptAllowed(clientKey) {
  if (joinAttemptHistoryByClient.size > 5_000) {
    const cutoff = Date.now() - joinAttemptWindowMs;
    for (const [key, timestamps] of joinAttemptHistoryByClient) {
      if (!timestamps.some((timestamp) => timestamp > cutoff)) joinAttemptHistoryByClient.delete(key);
      if (joinAttemptHistoryByClient.size <= 4_000) break;
    }
  }
  const cutoff = Date.now() - joinAttemptWindowMs;
  const history = (joinAttemptHistoryByClient.get(clientKey) ?? []).filter((timestamp) => timestamp > cutoff);
  history.push(Date.now());
  joinAttemptHistoryByClient.set(clientKey, history);
  if (history.length > joinAttemptsPerWindow) throw new Error("加入房间尝试过于频繁，请稍后再试");
}

function trackRoomCreation(code, clientKey) {
  roomClients.set(code, clientKey);
  activeRoomsByClient.set(clientKey, (activeRoomsByClient.get(clientKey) ?? 0) + 1);
  const history = roomCreationHistory(clientKey);
  history.push(Date.now());
  roomCreateHistoryByClient.set(clientKey, history);
}

function releaseRoom(code) {
  const clientKey = roomClients.get(code);
  if (!clientKey) return;
  roomClients.delete(code);
  const next = (activeRoomsByClient.get(clientKey) ?? 1) - 1;
  if (next > 0) activeRoomsByClient.set(clientKey, next);
  else activeRoomsByClient.delete(clientKey);
}

function send(socket, type, data = {}) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type, ...data }));
}

function lobbySnapshot() {
  return {
    rooms: manager.publicLobbyRooms(),
    roomCount: manager.roomCount(),
    maxRooms,
  };
}

function broadcastLobby() {
  lobbyBroadcastTimer = null;
  const data = lobbySnapshot();
  for (const socket of lobbySubscribers) send(socket, "lobby:snapshot", data);
}

function scheduleLobbyBroadcast() {
  if (lobbyBroadcastTimer) return;
  lobbyBroadcastTimer = setTimeout(broadcastLobby, 300);
}

function leaveLobby(socket) {
  lobbySubscribers.delete(socket);
}

function clearCountdown(code) {
  const timer = countdownTimers.get(code);
  if (timer) clearTimeout(timer);
  countdownTimers.delete(code);
}

function clearClueStage(code) {
  const timer = clueStageTimers.get(code);
  if (timer) clearTimeout(timer);
  clueStageTimers.delete(code);
}

function clearDisconnect(playerId) {
  for (const [key, timer] of disconnectTimers) {
    if (key.endsWith(`:${playerId}`)) {
      clearTimeout(timer);
      disconnectTimers.delete(key);
    }
  }
}

function clearContext(socket, context) {
  if (!context) return;
  if (context.playerId && sockets.get(context.playerId) === socket) sockets.delete(context.playerId);
  context.role = null;
  context.playerId = null;
  context.code = null;
  context.deviceId = null;
}

function notifyRoomClosed(closed, message = "房间已解散") {
  if (!closed) return;
  releaseRoom(closed.code);
  for (const playerId of closed.playerIds ?? []) releasePlayerSeat(playerId);
  clearCountdown(closed.code);
  clearClueStage(closed.code);
  for (const playerId of closed.playerIds ?? []) {
    clearDisconnect(playerId);
    const socket = sockets.get(playerId);
    const context = contexts.get(socket);
    if (!socket || !context) continue;
    send(socket, "room:closed", { message, reason: closed.reason });
    clearContext(socket, context);
    lobbySubscribers.add(socket);
    send(socket, "lobby:snapshot", lobbySnapshot());
  }
  scheduleLobbyBroadcast();
}

function broadcastResult(result) {
  const roomPlayerIds = new Set(result.room ? [...result.room.players.keys()] : []);
  for (const item of result.events ?? []) {
    if (item.target) {
      send(sockets.get(item.target), item.type, item.data);
      continue;
    }
    for (const playerId of roomPlayerIds) send(sockets.get(playerId), item.type, item.data);
  }
  if (result.closed) clearClueStage(result.closed.code);
  if (result.room?.gameType === "clues" && result.room.status === "playing" && result.room.stageEndsAt) {
    scheduleClueStage(result.room);
  } else if (result.room) {
    clearClueStage(result.room.code);
  }
  scheduleLobbyBroadcast();
}

function scheduleCountdown(room) {
  clearCountdown(room.code);
  const delay = Math.max(0, room.countdownEndsAt - Date.now());
  countdownTimers.set(room.code, setTimeout(() => {
    countdownTimers.delete(room.code);
    try {
      broadcastResult(manager.startPlaying(room.code));
    } catch {
      // The room may have been dissolved while the countdown was pending.
    }
  }, delay));
}

function scheduleClueStage(room) {
  if (!room || room.gameType !== "clues" || room.status !== "playing" || !room.stageEndsAt) {
    if (room?.code) clearClueStage(room.code);
    return;
  }
  clearClueStage(room.code);
  const delay = Math.max(0, room.stageEndsAt - Date.now());
  clueStageTimers.set(room.code, setTimeout(() => {
    clueStageTimers.delete(room.code);
    try {
      broadcastResult(manager.resolveClueStageIfReady(room.code, true));
    } catch {
      // The room may have been dissolved or the round replaced.
    }
  }, delay));
}

function scheduleDisconnect(room, playerId) {
  const key = `${room.code}:${playerId}`;
  const previous = disconnectTimers.get(key);
  if (previous) clearTimeout(previous);
  disconnectTimers.set(key, setTimeout(() => {
    disconnectTimers.delete(key);
    try {
      const previousStatus = room.status;
      const result = manager.expireDisconnected(room.code, playerId);
      if (previousStatus === "countdown" && result.room?.status !== "countdown") clearCountdown(room.code);
      if (result.closed) {
        notifyRoomClosed(result.closed, result.closed.reason === "host-disconnected" ? "房主已离开，房间已解散" : "房间中的玩家已经离开");
      } else {
        releasePlayerSeat(playerId);
        broadcastResult(result);
      }
      logPk("disconnect_expired", {
        previousStatus,
        resultingStatus: result.room?.status ?? "closed",
        roomCount: manager.roomCount(),
      });
    } catch {
      // The room may have expired or the player may have reconnected.
    }
  }, disconnectGraceMs));
}

function consumeMessageBudget(context) {
  const current = Date.now();
  if (current - context.messageWindowStart >= messageWindowMs) {
    context.messageWindowStart = current;
    context.messageCount = 0;
  }
  context.messageCount += 1;
  return context.messageCount <= maxMessagesPerWindow;
}

function recordRejectedMessage(context, requestType, reason) {
  const current = Date.now();
  if (current - context.rejectionWindowStart >= messageWindowMs) {
    if (context.suppressedRejections > 0) {
      logPk("request_rejected_summary", { count: context.suppressedRejections });
    }
    context.rejectionWindowStart = current;
    context.rejectedInWindow = 0;
    context.suppressedRejections = 0;
  }
  context.rejectedInWindow += 1;
  if (context.rejectedInWindow <= 3) {
    logPk("request_rejected", { requestType, reason });
  } else {
    context.suppressedRejections += 1;
  }
}

function shouldCloseAfterRejection(context, error) {
  if (context.rejectedInWindow < 8) return false;
  const message = error instanceof Error ? error.message : "";
  return /请求过于频繁|消息过大|无效消息|无效请求|不支持的消息类型/u.test(message);
}

function requireText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function optionalDeviceId(value) {
  const deviceId = typeof value === "string" ? value.trim().slice(0, 80) : "";
  return deviceId.length >= 8 ? deviceId : null;
}

function hasDeviceConflict(socket, deviceId, allowedPlayerId = null) {
  if (!deviceId) return false;
  const activeContext = [...contexts.entries()].find(([candidateSocket, candidate]) => (
    candidateSocket !== socket
    && candidate.deviceId === deviceId
    && candidate.role === "player"
    && candidate.playerId !== allowedPlayerId
  ));
  const activePlayer = manager.playerByDevice(deviceId);
  return Boolean(activeContext || (activePlayer && activePlayer.player.id !== allowedPlayerId));
}

function claimAvailableDevice(socket, context, value) {
  const deviceId = optionalDeviceId(value);
  if (hasDeviceConflict(socket, deviceId)) {
    logPk("duplicate_device_blocked", { activeConnections: wss.clients.size });
    throw new Error("当前浏览器已经加入了一个多人房间，请在原页面继续或刷新后重连");
  }
  context.deviceId = deviceId;
  return deviceId;
}

function requireUnjoined(context) {
  if (context.role) throw new Error("当前连接已经加入房间");
}

function requirePlayer(context) {
  if (context.role !== "player" || !context.playerId || !context.code) throw new Error("当前连接未加入多人房间");
}

function handleMessage(socket, context, message) {
  if (!consumeMessageBudget(context)) throw new Error("请求过于频繁，请稍后再试");
  if (!message || typeof message !== "object" || typeof message.type !== "string") throw new Error("无效消息");
  if (draining && (message.type === "room:create" || message.type === "room:join")) {
    throw new Error("多人服务正在更新，请稍后再试");
  }

  let result;
  switch (message.type) {
    case "room:create": {
      requireUnjoined(context);
      const creatorName = requireText(message.name).trim();
      if (!creatorName) throw new Error("请先输入昵称再创建房间");
      assertRoomCreationAllowed(context.clientKey);
      assertPlayerSeatAllowed(context.clientKey);
      const deviceId = claimAvailableDevice(socket, context, message.deviceId);
      result = manager.createRoom(creatorName, message.mode, message.visibility, deviceId, message.pool, message.gameType);
      trackRoomCreation(result.room.code, context.clientKey);
      trackPlayerSeat(result.player.id, context.clientKey);
      context.role = "player";
      context.playerId = result.player.id;
      context.code = result.room.code;
      sockets.set(context.playerId, socket);
      leaveLobby(socket);
      logPk("room_created", { visibility: result.room.visibility, gameType: result.room.gameType, mode: result.room.mode, pool: result.room.pool, roomCount: manager.roomCount() });
      break;
    }
    case "room:join": {
      requireUnjoined(context);
      assertJoinAttemptAllowed(context.clientKey);
      assertPlayerSeatAllowed(context.clientKey);
      const deviceId = claimAvailableDevice(socket, context, message.deviceId);
      result = manager.joinRoom(requireText(message.code), requireText(message.name), deviceId);
      trackPlayerSeat(result.player.id, context.clientKey);
      context.role = "player";
      context.playerId = result.player.id;
      context.code = result.room.code;
      sockets.set(context.playerId, socket);
      leaveLobby(socket);
      logPk("room_joined", { visibility: result.room.visibility, playerCount: result.room.players.size });
      break;
    }
    case "room:reconnect": {
      requireUnjoined(context);
      const deviceId = optionalDeviceId(message.deviceId);
      try {
        const reconnectCode = requireText(message.code);
        const playerToken = requireText(message.playerToken);
        const summary = manager.forfeitSummary(reconnectCode, playerToken, deviceId);
        if (summary) {
          send(socket, "room:forfeit-summary", {
            ...summary,
            message: "断线时间过长，本局已记为失败",
          });
          lobbySubscribers.add(socket);
          send(socket, "lobby:snapshot", lobbySnapshot());
          return;
        }
        const room = manager.getRoom(reconnectCode);
        const target = [...room.players.values()].find((player) => player.token === playerToken);
        if (hasDeviceConflict(socket, deviceId, target?.id ?? null)) {
          send(socket, "room:active-elsewhere", { message: "这个浏览器已经在另一个多人身份中使用" });
          return;
        }
        result = manager.reconnectRoom(reconnectCode, playerToken, deviceId);
      } catch (error) {
        logPk("room_reconnect_failed", { reason: error instanceof Error ? error.message : "unknown" });
        send(socket, "room:reconnect-failed", { message: error instanceof Error ? error.message : "原房间已经失效" });
        return;
      }
      const previousSocket = sockets.get(result.player.id);
      if (previousSocket && previousSocket !== socket && previousSocket.readyState === WebSocket.OPEN && message.takeover !== true) {
        send(socket, "room:active-elsewhere", { message: "这个房间正在另一个标签页中使用" });
        return;
      }
      clearDisconnect(result.player.id);
      context.role = "player";
      context.deviceId = deviceId ?? result.player.deviceId;
      context.playerId = result.player.id;
      context.code = result.room.code;
      sockets.set(context.playerId, socket);
      leaveLobby(socket);
      if (previousSocket && previousSocket !== socket && previousSocket.readyState === WebSocket.OPEN) previousSocket.close(4001, "reconnected");
      send(socket, "room:reconnected", { code: result.room.code, playerId: result.player.id, room: manager.publicState(result.room) });
      for (const item of result.events ?? []) {
        if (!item.target || item.target === result.player.id) send(socket, item.type, item.data);
      }
      logPk("room_reconnected", { status: result.room.status, takeover: Boolean(message.takeover) });
      break;
    }
    case "lobby:subscribe":
      if (context.role) throw new Error("请先退出当前房间");
      lobbySubscribers.add(socket);
      send(socket, "lobby:snapshot", lobbySnapshot());
      return;
    case "lobby:unsubscribe":
      leaveLobby(socket);
      return;
    case "room:update-settings":
      requirePlayer(context);
      result = manager.updateSettings(context.code, context.playerId, message.mode, message.pool, message.gameType);
      break;
    case "player:ready":
      requirePlayer(context);
      result = manager.setReady(context.code, context.playerId, message.ready !== false);
      break;
    case "round:start":
      requirePlayer(context);
      result = manager.startRoom(context.code, context.playerId);
      break;
    case "round:next-ready":
      requirePlayer(context);
      result = manager.setNextReady(context.code, context.playerId, message.ready !== false);
      break;
    case "round:lobby":
      requirePlayer(context);
      {
        const previousRoom = manager.getRoom(context.code);
        const previousPlayerIds = new Set(previousRoom.players.keys());
        result = manager.returnToLobby(context.code, context.playerId);
        if (result.room) {
          for (const playerId of previousPlayerIds) {
            if (!result.room.players.has(playerId)) releasePlayerSeat(playerId);
          }
        } else if (result.closed) {
          for (const playerId of previousPlayerIds) releasePlayerSeat(playerId);
        }
      }
      break;
    case "room:kick": {
      requirePlayer(context);
      result = manager.kick(context.code, context.playerId, requireText(message.targetPlayerId));
      const kickedSocket = sockets.get(result.kickedPlayerId);
      const kickedContext = contexts.get(kickedSocket);
      if (kickedSocket && kickedContext) {
        send(kickedSocket, "room:kicked", { message: "你已被房主移出房间" });
        clearContext(kickedSocket, kickedContext);
        lobbySubscribers.add(kickedSocket);
        send(kickedSocket, "lobby:snapshot", lobbySnapshot());
      }
      clearDisconnect(result.kickedPlayerId);
      releasePlayerSeat(result.kickedPlayerId);
      logPk("player_kicked", { roomCode: context.code, roomCount: manager.roomCount() });
      break;
    }
    case "guess:submit":
      requirePlayer(context);
      result = manager.submitGuess(context.code, context.playerId, requireText(message.bvid));
      break;
    case "clue:skip":
      requirePlayer(context);
      result = manager.submitClueAction(context.code, context.playerId, "skip");
      break;
    case "room:leave": {
      requirePlayer(context);
      const leavingCode = context.code;
      const previousRoom = manager.getRoom(leavingCode);
      const previousStatus = previousRoom.status;
      clearCountdown(leavingCode);
      clearClueStage(leavingCode);
      result = manager.leave(leavingCode, context.playerId);
      logPk("player_left", {
        previousStatus,
        resultingStatus: result.room?.status ?? "closed",
        roomCount: manager.roomCount(),
      });
      if (result.closed) {
        notifyRoomClosed(result.closed, result.closed.reason === "host-left" ? "房主已解散房间" : "房间已关闭");
        return;
      }
      releasePlayerSeat(context.playerId);
      break;
    }
    case "ping":
      send(socket, "pong", { at: Date.now() });
      return;
    default:
      throw new Error("不支持的消息类型");
  }

  broadcastResult(result);
  if (result.room?.status === "countdown") scheduleCountdown(result.room);
  if (message.type === "room:leave") {
    clearContext(socket, context);
    send(socket, "room:left");
  }
}

wss.on("connection", (socket, request) => {
  const clientKey = getClientKey(request);
  if (wss.clients.size >= maxConnections || (clientConnectionCounts.get(clientKey) ?? 0) >= maxConnectionsPerIp) {
    rejectedConnections += 1;
    socket.close(1013, "服务繁忙，请稍后再试");
    return;
  }
  incrementClientConnection(clientKey);

  socket.isAlive = true;
  socket.on("pong", () => {
    socket.isAlive = true;
  });
  socket.on("error", () => {
    // The close handler performs the state transition and disconnect timeout.
  });
  const context = {
    role: null,
    playerId: null,
    code: null,
    messageWindowStart: Date.now(),
    messageCount: 0,
    rejectionWindowStart: Date.now(),
    rejectedInWindow: 0,
    suppressedRejections: 0,
    deviceId: null,
    clientKey,
  };
  contexts.set(socket, context);

  socket.on("message", (raw) => {
    try {
      const text = raw.toString("utf8");
      if (text.length > 16 * 1024) throw new Error("消息过大");
      handleMessage(socket, context, JSON.parse(text));
    } catch (error) {
      rejectedMessages += 1;
      let requestType = "unknown";
      try {
        requestType = String(JSON.parse(raw.toString("utf8"))?.type ?? "unknown").slice(0, 40);
      } catch {
        requestType = "invalid_json";
      }
      recordRejectedMessage(context, requestType, error instanceof Error ? error.message : "unknown");
      send(socket, "error", { message: error instanceof Error ? error.message : "请求失败" });
      if (shouldCloseAfterRejection(context, error)) socket.close(1008, "请求异常");
    }
  });

  socket.on("close", () => {
    decrementClientConnection(clientKey);
    leaveLobby(socket);
    contexts.delete(socket);
    if (!context.playerId || sockets.get(context.playerId) !== socket) return;
    sockets.delete(context.playerId);
    const result = manager.disconnect(context.playerId);
    broadcastResult(result);
    if (result.room) {
      logPk("player_disconnected", { status: result.room.status, roomCount: manager.roomCount() });
      scheduleDisconnect(result.room, context.playerId);
    }
  });
});

const cleanupTimer = setInterval(() => {
  for (const expired of manager.cleanup()) {
    logPk("room_expired", { playerCount: expired.playerIds.length, roomCount: manager.roomCount() });
    notifyRoomClosed(expired, "房间因长时间无活动已关闭");
  }
  scheduleLobbyBroadcast();
}, 60_000);
cleanupTimer.unref();

function updateMetricAlert(name, value, threshold) {
  const active = value >= threshold;
  const wasActive = metricAlertState.get(name) ?? false;
  if (active && !wasActive) {
    logPk("metrics_alert", { metric: name, value, threshold });
  } else if (!active && wasActive) {
    logPk("metrics_alert_cleared", { metric: name, value, threshold });
  }
  metricAlertState.set(name, active);
}

const metricsTimer = setInterval(() => {
  const metrics = {
    activeConnections: wss.clients.size,
    roomCount: manager.roomCount(),
    activePlayerSeats: [...activePlayerSeatsByClient.values()].reduce((sum, count) => sum + count, 0),
    lobbySubscribers: lobbySubscribers.size,
    rejectedConnections,
    rejectedMessages,
    blockedRoomCreations,
    draining,
  };
  logPk("metrics", metrics);
  updateMetricAlert("activeConnections", metrics.activeConnections, Math.max(1, Math.ceil(maxConnections * connectionAlertRatio)));
  updateMetricAlert("roomCount", metrics.roomCount, Math.max(1, Math.ceil(maxRooms * roomAlertRatio)));
  updateMetricAlert("blockedRoomCreations", metrics.blockedRoomCreations, 1);
  rejectedConnections = 0;
  rejectedMessages = 0;
  blockedRoomCreations = 0;
}, metricsIntervalMs);
metricsTimer.unref();

const heartbeatTimer = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, heartbeatMs);
heartbeatTimer.unref();

wss.on("listening", () => {
  logPk("service_started", {
    host,
    port,
    maxConnections,
    maxConnectionsPerIp,
    maxRooms,
    maxActiveRoomsPerIp,
    maxActivePlayerSeatsPerIp,
    maxRoomCreatesPerWindow,
    absoluteRoomTtlMs,
    guessIntervalMs,
    startGraceMs,
    joinAttemptsPerWindow,
    disconnectGraceMs,
    countdownMs,
    roomTtlMs,
    lobbyRoomTtlMs,
    metricsIntervalMs,
    connectionAlertRatio,
    roomAlertRatio,
  });
});

healthServer.listen(port, host);

function beginDrain() {
  if (draining) return;
  draining = true;
  maintenanceStartedAt = new Date().toISOString();
  logPk("service_draining", { activeConnections: wss.clients.size, roomCount: manager.roomCount() });
  for (const socket of wss.clients) {
    send(socket, "service:maintenance", { message: ROUND_INVALIDATED_MESSAGE });
  }
}

function resumeFromDrain() {
  if (!draining) return;
  draining = false;
  maintenanceStartedAt = null;
  logPk("service_resumed", { activeConnections: wss.clients.size, roomCount: manager.roomCount() });
  for (const socket of wss.clients) {
    send(socket, "service:resumed", { message: "多人服务已恢复，可以继续游戏" });
  }
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  beginDrain();
  logPk("service_stopping", { activeConnections: wss.clients.size, roomCount: manager.roomCount() });
  clearInterval(cleanupTimer);
  clearInterval(metricsTimer);
  clearInterval(heartbeatTimer);
  if (lobbyBroadcastTimer) clearTimeout(lobbyBroadcastTimer);
  for (const timer of countdownTimers.values()) clearTimeout(timer);
  for (const timer of clueStageTimers.values()) clearTimeout(timer);
  for (const timer of disconnectTimers.values()) clearTimeout(timer);
  const forceCloseTimer = setTimeout(() => {
    for (const socket of wss.clients) socket.terminate();
  }, 5_000);
  wss.close(() => {
    clearTimeout(forceCloseTimer);
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
