import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";

import { WebSocket } from "ws";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function waitForStart(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("PK server start timeout")), 5_000);
    child.once("exit", (code) => reject(new Error(`PK server exited with ${code}`)));
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes('"event":"service_started"')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

async function connect(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin: "http://127.0.0.1:3000" });
  const inbox = [];
  const listeners = new Set();
  socket.on("message", (raw) => {
    inbox.push(JSON.parse(String(raw)));
    for (const listener of listeners) listener();
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return {
    socket,
    send(type, data = {}) {
      socket.send(JSON.stringify({ type, ...data }));
    },
    wait(type, timeout = 3_000, predicate = () => true) {
      return new Promise((resolve, reject) => {
        const read = () => {
          const index = inbox.findIndex((message) => message.type === type && predicate(message));
          if (index < 0) return;
          cleanup();
          resolve(inbox.splice(index, 1)[0]);
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`Timed out waiting for ${type}: ${JSON.stringify(inbox)}`));
        }, timeout);
        const cleanup = () => {
          clearTimeout(timer);
          listeners.delete(read);
        };
        listeners.add(read);
        read();
      });
    },
  };
}

async function startServer(context, extraEnv = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ["server/pk-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PK_HOST: "127.0.0.1",
      PK_PORT: String(port),
      PK_ALLOWED_ORIGINS: "http://127.0.0.1:3000",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logOutput = "";
  child.stdout.on("data", (chunk) => { logOutput += String(chunk); });
  const clients = [];
  context.after(() => {
    for (const client of clients) client.socket.close();
    child.kill("SIGTERM");
  });
  await waitForStart(child);
  return { port, child, clients, getLog: () => logOutput };
}

async function waitForHealth(port, expectedStatus) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.status === expectedStatus) return response.json();
    } catch {
      // The service may be between systemd-style restarts; keep polling briefly.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`health endpoint did not reach HTTP ${expectedStatus}`);
}

async function waitForLog(server, pattern, timeout = 4_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (pattern.test(server.getLog())) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for PK log ${pattern}: ${server.getLog()}`);
}

test("explicit host leave dissolves the room and notifies every connected guest", async (context) => {
  const server = await startServer(context);
  const host = await connect(server.port);
  const guest = await connect(server.port);
  server.clients.push(host, guest);

  host.send("room:create", { name: "甲", visibility: "private", deviceId: "integration-device-a" });
  const created = await host.wait("room:created");
  guest.send("room:join", { code: created.code, name: "乙", deviceId: "integration-device-b" });
  const joined = await guest.wait("room:joined");
  assert.equal(joined.room.maxPlayers, 8);

  host.send("player:ready");
  guest.send("player:ready");
  await guest.wait("room:state", 3_000, (message) => message.players.every((player) => player.ready));
  host.send("round:start");
  await Promise.all([host.wait("round:countdown"), guest.wait("round:countdown")]);

  host.send("room:leave");
  const [closedHost, closedGuest] = await Promise.all([host.wait("room:closed"), guest.wait("room:closed")]);
  assert.match(closedHost.message, /房主/);
  assert.match(closedGuest.message, /房主/);
  assert.doesNotMatch(server.getLog(), /甲|乙/);
  assert.doesNotMatch(server.getLog(), new RegExp(created.code));
  assert.doesNotMatch(server.getLog(), new RegExp(created.playerToken));
});

test("reconnect after disconnect expiry returns a deduplicated loss summary", async (context) => {
  const server = await startServer(context, { PK_COUNTDOWN_MS: "100", PK_DISCONNECT_GRACE_MS: "100" });
  const host = await connect(server.port);
  const guest = await connect(server.port);
  server.clients.push(host, guest);

  host.send("room:create", { name: "断线房主", visibility: "private", deviceId: "receipt-host" });
  const created = await host.wait("room:created");
  guest.send("room:join", { code: created.code, name: "断线访客", deviceId: "receipt-guest" });
  const joined = await guest.wait("room:joined");
  host.send("player:ready");
  guest.send("player:ready");
  await host.wait("room:state", 3_000, (message) => message.players.every((player) => player.ready));
  host.send("round:start");
  const [started] = await Promise.all([host.wait("round:started"), guest.wait("round:started")]);

  await new Promise((resolve) => {
    guest.socket.once("close", resolve);
    guest.socket.close();
  });
  await new Promise((resolve) => setTimeout(resolve, 250));

  const recovered = await connect(server.port);
  server.clients.push(recovered);
  recovered.send("room:reconnect", {
    code: created.code,
    playerToken: joined.playerToken,
    deviceId: "receipt-guest",
  });
  const summary = await recovered.wait("room:forfeit-summary");
  assert.equal(summary.roundId, started.roundId);
  assert.equal(summary.pool, "normal");
  assert.equal(summary.mode, "normal");
  assert.equal(summary.attempts, 0);
  assert.match(summary.message, /记为失败/);
});

test("requires a nickname to create, supports host kicking, and has no spectator or matchmaking protocol", async (context) => {
  const server = await startServer(context);
  const host = await connect(server.port);
  const guest = await connect(server.port);
  const extra = await connect(server.port);
  server.clients.push(host, guest, extra);

  host.send("room:create", { name: "   ", visibility: "public", deviceId: "host-device" });
  assert.match((await host.wait("error")).message, /输入昵称/);
  host.send("room:create", { name: "房主", visibility: "public", deviceId: "host-device" });
  const created = await host.wait("room:created");
  guest.send("room:join", { code: created.code, name: "访客", deviceId: "guest-device" });
  const joined = await guest.wait("room:joined");

  host.send("room:kick", { targetPlayerId: joined.playerId });
  const [kicked, updated] = await Promise.all([
    guest.wait("room:kicked"),
    host.wait("room:state", 3_000, (message) => message.players.length === 1),
  ]);
  assert.match(kicked.message, /移出/);
  assert.equal(updated.players.length, 1);

  extra.send("room:spectate", { code: created.code, deviceId: "spectator-device" });
  assert.match((await extra.wait("error")).message, /不支持/);
  extra.send("matchmaking:join", { name: "匹配者", mode: "normal", deviceId: "match-device" });
  assert.match((await extra.wait("error")).message, /不支持/);
});

test("allows only the host to change lobby settings and locks them after start", async (context) => {
  const server = await startServer(context);
  const host = await connect(server.port);
  const guest = await connect(server.port);
  server.clients.push(host, guest);

  host.send("room:create", { name: "设置房主", visibility: "private", deviceId: "settings-host" });
  const created = await host.wait("room:created");
  guest.send("room:join", { code: created.code, name: "设置访客", deviceId: "settings-guest" });
  await guest.wait("room:joined");

  host.send("player:ready");
  guest.send("player:ready");
  await host.wait("room:state", 3_000, (message) => message.players.every((player) => player.ready));

  host.send("room:update-settings", { mode: "hard", pool: "extended" });
  const [hostUpdated, guestUpdated] = await Promise.all([
    host.wait("room:state", 3_000, (message) => message.mode === "hard" && message.pool === "hardcore"),
    guest.wait("room:state", 3_000, (message) => message.mode === "hard" && message.pool === "hardcore"),
  ]);
  assert.equal(hostUpdated.maxGuesses, 4);
  assert.ok(hostUpdated.players.every((player) => !player.ready));
  assert.ok(guestUpdated.players.every((player) => !player.ready));

  guest.send("room:update-settings", { mode: "normal", pool: "normal" });
  assert.match((await guest.wait("error")).message, /只有房主/);

  host.send("player:ready");
  guest.send("player:ready");
  await host.wait("room:state", 3_000, (message) => message.players.every((player) => player.ready));
  host.send("round:start");
  await host.wait("round:countdown");
  host.send("room:update-settings", { mode: "normal", pool: "normal" });
  assert.match((await host.wait("error")).message, /准备阶段/);
});

test("limits active room creation from one network and releases the quota when a room closes", async (context) => {
  const server = await startServer(context, { PK_MAX_ACTIVE_ROOMS_PER_IP: "1" });
  const first = await connect(server.port);
  const second = await connect(server.port);
  server.clients.push(first, second);

  first.send("room:create", { name: "第一间", visibility: "private", deviceId: "quota-device-a" });
  const created = await first.wait("room:created");

  second.send("room:create", { name: "第二间", visibility: "private", deviceId: "quota-device-b" });
  assert.match((await second.wait("error")).message, /房间太多/);

  first.send("room:leave");
  await first.wait("room:closed");

  second.send("room:create", { name: "第二间", visibility: "private", deviceId: "quota-device-b" });
  const recreated = await second.wait("room:created");
  assert.notEqual(recreated.code, created.code);
});

test("limits simultaneous player seats from one network", async (context) => {
  const server = await startServer(context, { PK_MAX_ACTIVE_PLAYER_SEATS_PER_IP: "2" });
  const host = await connect(server.port);
  const guest = await connect(server.port);
  const extra = await connect(server.port);
  server.clients.push(host, guest, extra);

  host.send("room:create", { name: "房主", visibility: "private", deviceId: "seat-host" });
  const created = await host.wait("room:created");
  guest.send("room:join", { code: created.code, name: "访客", deviceId: "seat-guest" });
  await guest.wait("room:joined");
  extra.send("room:join", { code: created.code, name: "第三人", deviceId: "seat-extra" });
  assert.match((await extra.wait("error")).message, /参赛人数/);
});

test("throttles failed private-room join attempts", async (context) => {
  const server = await startServer(context, { PK_JOIN_ATTEMPTS_PER_WINDOW: "2" });
  const client = await connect(server.port);
  server.clients.push(client);

  client.send("room:join", { code: "AAAAAA", name: "尝试者", deviceId: "join-attempt-device" });
  assert.match((await client.wait("error")).message, /房间不存在/);
  client.send("room:join", { code: "BBBBBB", name: "尝试者", deviceId: "join-attempt-device" });
  assert.match((await client.wait("error")).message, /房间不存在/);
  client.send("room:join", { code: "CCCCCC", name: "尝试者", deviceId: "join-attempt-device" });
  assert.match((await client.wait("error")).message, /尝试过于频繁/);
});

test("public lobby exposes waiting multiplayer rooms and no active answer", async (context) => {
  const server = await startServer(context, { PK_MAX_ROOMS: "15" });
  const host = await connect(server.port);
  const lobby = await connect(server.port);
  server.clients.push(host, lobby);
  lobby.send("lobby:subscribe");
  const initial = await lobby.wait("lobby:snapshot");
  assert.equal(initial.maxRooms, 15);

  host.send("room:create", { name: "公开房主", visibility: "public", mode: "hard", pool: "extended", deviceId: "public-host" });
  const created = await host.wait("room:created");
  assert.equal(created.room.pool, "hardcore");
  assert.equal(created.room.poolLabel, "扩展题库");
  const snapshot = await lobby.wait("lobby:snapshot", 3_000, (message) => message.rooms.some((room) => room.code === created.code));
  const listed = snapshot.rooms.find((room) => room.code === created.code);
  assert.equal(listed.mode, "hard");
  assert.equal(listed.pool, "hardcore");
  assert.equal(listed.poolLabel, "扩展题库");
  assert.equal(listed.maxPlayers, 8);
  assert.equal(listed.joinable, true);
  assert.equal(listed.answerBvid, undefined);
});

test("clue ladder protocol keeps answers and correctness private until the stage ends", async (context) => {
  const server = await startServer(context, { PK_COUNTDOWN_MS: "0", PK_START_GRACE_MS: "0" });
  const host = await connect(server.port);
  const guest = await connect(server.port);
  server.clients.push(host, guest);

  host.send("room:create", {
    name: "阶梯房主",
    visibility: "private",
    gameType: "clues",
    deviceId: "clue-protocol-host",
  });
  const created = await host.wait("room:created");
  assert.equal(created.room.gameType, "clues");
  assert.equal(created.room.maxGuesses, 6);

  guest.send("room:join", {
    code: created.code,
    name: "阶梯访客",
    deviceId: "clue-protocol-guest",
  });
  await guest.wait("room:joined");
  host.send("player:ready");
  guest.send("player:ready");
  await host.wait("room:state", 3_000, (message) => message.players.every((player) => player.ready));
  host.send("round:start");
  await host.wait("round:countdown");
  const started = await host.wait("round:started");
  assert.equal(started.gameType, "clues");
  assert.equal(started.clueStage, 1);

  host.send("clue:skip");
  const submitted = await host.wait("clue:submitted");
  assert.equal(submitted.actionType, "skip");
  assert.equal("correct" in submitted, false);
  assert.equal("answer" in submitted, false);
  assert.equal(submitted.bvid, null);
  await assert.rejects(guest.wait("clue:submitted", 200), /Timed out waiting for clue:submitted/);

  guest.send("clue:skip");
  const nextStage = await host.wait("clue:stage");
  assert.equal(nextStage.stage, 2);
  assert.equal(nextStage.clues.length, 2);
  assert.equal("answer" in nextStage, false);
  assert.equal("bvid" in nextStage, false);
});

test("health endpoint reports maintenance drain and notifies connected players", async (context) => {
  const server = await startServer(context);
  const client = await connect(server.port);
  server.clients.push(client);
  const healthy = await waitForHealth(server.port, 200);
  assert.equal(healthy.status, "ok");
  assert.equal(healthy.roomCount, 0);

  const drainResponse = await fetch(`http://127.0.0.1:${server.port}/drain`, { method: "POST" });
  assert.equal(drainResponse.status, 202);
  const maintenance = await client.wait("service:maintenance");
  assert.match(maintenance.message, /更新/);
  const draining = await waitForHealth(server.port, 503);
  assert.equal(draining.status, "draining");
  assert.equal(draining.draining, true);

  const resumeResponse = await fetch(`http://127.0.0.1:${server.port}/resume`, { method: "POST" });
  assert.equal(resumeResponse.status, 200);
  const resumed = await client.wait("service:resumed");
  assert.match(resumed.message, /恢复/);
  const healthyAgain = await waitForHealth(server.port, 200);
  assert.equal(healthyAgain.status, "ok");
});

test("metrics emit threshold alerts without logging player data", async (context) => {
  const server = await startServer(context, {
    PK_MAX_CONNECTIONS: "2",
    PK_CONNECTION_ALERT_RATIO: "0.5",
    PK_METRICS_INTERVAL_MS: "1000",
  });
  const client = await connect(server.port);
  server.clients.push(client);
  await waitForLog(server, /"event":"metrics_alert"/);
  assert.doesNotMatch(server.getLog(), /integration-device|匿名|玩家/);
});
