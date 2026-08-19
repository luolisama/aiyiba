import assert from "node:assert/strict";
import test from "node:test";

import songsJson from "../app/data/songs.json" with { type: "json" };
import hardcoreSongsJson from "../app/data/hardcore-songs.json" with { type: "json" };
import { createPkManager } from "../server/pk-game.mjs";

function eventOf(result, type) {
  return result.events.find((item) => item.type === type);
}

function makeManager(options = {}) {
  let clock = 1_000;
  const manager = createPkManager({ normal: songsJson, hardcore: hardcoreSongsJson }, {
    now: () => clock,
    countdownMs: 1,
    randomIndex: () => 0,
    ...options,
  });
  return { manager, advance(value) { clock += value; } };
}

function readyRoom(manager, names = ["甲", "乙"], mode = "normal") {
  const created = manager.createRoom(names[0], mode, "private", `device-${names[0]}`);
  const joined = names.slice(1).map((name, index) => manager.joinRoom(created.room.code, name, `device-${name}-${index}`));
  for (const player of [created, ...joined]) manager.setReady(created.room.code, player.player.id);
  const countdown = manager.startRoom(created.room.code, created.player.id);
  manager.startPlaying(created.room.code);
  return { created, joined, countdown };
}

test("creates a 2–8 player room and only the ready host can start it", () => {
  const { manager } = makeManager();
  const created = manager.createRoom("房主", "normal", "public", "host-device");
  const guests = ["乙", "丙", "丁", "戊", "己", "庚", "辛"].map((name, index) => manager.joinRoom(created.room.code, name, `guest-${index}`));

  assert.equal(created.room.maxPlayers, 8);
  assert.equal(created.room.players.size, 8);
  assert.throws(() => manager.joinRoom(created.room.code, "第九人"), /满员/);
  assert.throws(() => manager.startRoom(created.room.code, guests[0].player.id), /房主/);
  assert.equal(created.room.status, "lobby");

  for (const player of [created, ...guests]) manager.setReady(created.room.code, player.player.id);
  const countdown = manager.startRoom(created.room.code, created.player.id);
  assert.equal(countdown.room.status, "countdown");
  assert.ok(eventOf(countdown, "round:countdown"));
  assert.equal(manager.publicState(created.room).players.length, 8);
});

test("requires a connected, ready roster before the host can start", () => {
  const { manager } = makeManager();
  const created = manager.createRoom("甲");
  const guest = manager.joinRoom(created.room.code, "乙");
  manager.setReady(created.room.code, created.player.id);
  assert.throws(() => manager.startRoom(created.room.code, created.player.id), /所有玩家准备/);
  manager.disconnect(guest.player.id);
  assert.throws(() => manager.startRoom(created.room.code, created.player.id), /所有玩家准备/);
});

test("host leave immediately dissolves the room and reports every seat", () => {
  const { manager } = makeManager();
  const created = manager.createRoom("房主");
  const guest = manager.joinRoom(created.room.code, "访客");
  const result = manager.leave(created.room.code, created.player.id);

  assert.equal(result.room, null);
  assert.deepEqual(result.closed.playerIds.sort(), [created.player.id, guest.player.id].sort());
  assert.equal(result.closed.reason, "host-left");
  assert.equal(manager.roomCount(), 0);
});

test("host disconnect expiry dissolves the room while guest disconnects release one seat", () => {
  const { manager } = makeManager();
  const created = manager.createRoom("房主", "normal", "public", "host-device");
  const guest = manager.joinRoom(created.room.code, "访客", "guest-device");
  manager.disconnect(guest.player.id);
  const released = manager.expireDisconnected(created.room.code, guest.player.id);
  assert.equal(released.room.players.size, 1);
  assert.equal(manager.publicLobbyRooms()[0].joinable, true);

  manager.disconnect(created.player.id);
  const dissolved = manager.expireDisconnected(created.room.code, created.player.id);
  assert.equal(dissolved.room, null);
  assert.equal(dissolved.closed.reason, "host-disconnected");
});

test("host can kick a player only from the waiting room", () => {
  const { manager } = makeManager();
  const created = manager.createRoom("房主");
  const guest = manager.joinRoom(created.room.code, "访客");
  const kicked = manager.kick(created.room.code, created.player.id, guest.player.id);
  assert.equal(kicked.kickedPlayerId, guest.player.id);
  assert.equal(kicked.room.players.size, 1);
  assert.equal(manager.getRoom(created.room.code).players.get(guest.player.id), undefined);
  assert.throws(() => manager.kick(created.room.code, created.player.id, created.player.id), /不能移出自己/);

  const { manager: activeManager } = makeManager({ randomIndex: () => 1 });
  const active = readyRoom(activeManager);
  assert.throws(() => activeManager.kick(active.created.room.code, active.created.player.id, active.joined[0].player.id), /准备大厅/);
});

test("playing guest leave is a forfeit and preserves the round recap", () => {
  const { manager } = makeManager();
  const { created, joined } = readyRoom(manager, ["甲", "乙", "丙"]);
  const wrong = songsJson.items.find((song) => song.bvid !== created.room.answerBvid).bvid;
  manager.submitGuess(created.room.code, joined[0].player.id, wrong);
  const left = manager.leave(created.room.code, joined[0].player.id);
  assert.equal(left.room.status, "playing");
  assert.equal(left.room.players.get(joined[0].player.id).forfeited, true);
  const ended = manager.submitGuess(created.room.code, joined[1].player.id, created.room.answerBvid);
  assert.equal(ended.room.status, "ended");
  const departed = eventOf(ended, "round:ended").data.players.find((player) => player.id === joined[0].player.id);
  assert.equal(departed.guesses.length, 1);
  assert.equal(departed.forfeited, true);
});

test("returning to the room keeps next-ready players prepared", () => {
  const { manager } = makeManager();
  const { created, joined } = readyRoom(manager);
  manager.submitGuess(created.room.code, joined[0].player.id, created.room.answerBvid);
  manager.setNextReady(created.room.code, joined[0].player.id, true);
  const lobby = manager.returnToLobby(created.room.code, created.player.id);

  assert.equal(lobby.room.status, "lobby");
  const lobbyState = manager.publicState(lobby.room);
  assert.equal(lobbyState.players.length, 2);
  assert.equal(lobbyState.players.find((player) => player.id === created.player.id).ready, true);
  assert.equal(lobbyState.players.find((player) => player.id === joined[0].player.id).ready, true);
  assert.equal(lobbyState.players.find((player) => player.id === joined[0].player.id).nextReady, false);
});

test("duplicate nicknames are rejected case-insensitively", () => {
  const { manager } = makeManager();
  const created = manager.createRoom("队长");
  assert.throws(() => manager.joinRoom(created.room.code, " 队长 "), /昵称已经在房间里/);
  assert.throws(() => manager.joinRoom(created.room.code, "\u200b"), /输入昵称/);
  const reservedManager = makeManager().manager;
  assert.throws(() => reservedManager.createRoom("管理员"), /不能使用/);
  assert.equal(reservedManager.createRoom("  国风\u200b轻电子  ").player.name, "国风轻电子");
  assert.equal(created.room.players.size, 1);
});

test("multiplayer rejects machine-speed guesses when production limits are enabled", () => {
  let clock = 1_000;
  const manager = createPkManager(songsJson, {
    now: () => clock,
    countdownMs: 0,
    startGraceMs: 300,
    guessIntervalMs: 500,
    randomIndex: (max) => max - 1,
  });
  const { created } = readyRoom(manager);
  const wrong = songsJson.items[1].bvid;
  assert.throws(() => manager.submitGuess(created.room.code, created.player.id, wrong), /倒计时/);
  clock += 301;
  manager.submitGuess(created.room.code, created.player.id, wrong);
  assert.throws(() => manager.submitGuess(created.room.code, created.player.id, songsJson.items[2].bvid), /太快/);
  clock += 500;
  assert.doesNotThrow(() => manager.submitGuess(created.room.code, created.player.id, songsJson.items[2].bvid));
});

test("public lobby lists waiting rooms without active answers or ended rooms", () => {
  let random = 0;
  const { manager } = makeManager({ randomIndex: (max) => random++ % max });
  const publicRoom = manager.createRoom("公开房主", "normal", "public");
  manager.createRoom("私密房主", "normal", "private");
  let listed = manager.publicLobbyRooms();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].code, publicRoom.room.code);
  assert.equal(listed[0].maxPlayers, 8);
  assert.equal(listed[0].answerBvid, undefined);

  const guest = manager.joinRoom(publicRoom.room.code, "公开访客");
  manager.setReady(publicRoom.room.code, publicRoom.player.id);
  manager.setReady(publicRoom.room.code, guest.player.id);
  manager.startRoom(publicRoom.room.code, publicRoom.player.id);
  manager.startPlaying(publicRoom.room.code);
  assert.equal(manager.publicLobbyRooms()[0].status, "playing");
  manager.submitGuess(publicRoom.room.code, guest.player.id, publicRoom.room.answerBvid);
  assert.equal(manager.publicLobbyRooms().length, 0);
});

test("extended rooms use their own catalog and expose the catalog in public state", () => {
  const { manager } = makeManager();
  const extensionOnly = hardcoreSongsJson.items.find((song) => !songsJson.items.some((normal) => normal.bvid === song.bvid));
  assert.ok(extensionOnly);
  const created = manager.createRoom("扩展房主", "normal", "public", "extended-host", "extended");
  const guest = manager.joinRoom(created.room.code, "扩展访客", "extended-guest");
  assert.equal(created.room.pool, "hardcore");
  assert.equal(manager.publicState(created.room).poolLabel, "扩展题库");
  assert.equal(manager.publicLobbyRooms()[0].pool, "hardcore");

  manager.setReady(created.room.code, created.player.id);
  manager.setReady(created.room.code, guest.player.id);
  manager.startRoom(created.room.code, created.player.id);
  manager.startPlaying(created.room.code);
  const result = manager.submitGuess(created.room.code, guest.player.id, extensionOnly.bvid);
  assert.equal(eventOf(result, "guess:result").data.bvid, extensionOnly.bvid);

  const { manager: normalManager } = makeManager();
  const normalRoom = normalManager.createRoom("标准房主", "normal", "private", "normal-host");
  const normalGuest = normalManager.joinRoom(normalRoom.room.code, "标准访客", "normal-guest");
  normalManager.setReady(normalRoom.room.code, normalRoom.player.id);
  normalManager.setReady(normalRoom.room.code, normalGuest.player.id);
  normalManager.startRoom(normalRoom.room.code, normalRoom.player.id);
  normalManager.startPlaying(normalRoom.room.code);
  assert.throws(() => normalManager.submitGuess(normalRoom.room.code, normalGuest.player.id, extensionOnly.bvid), /有效的题库作品/);
});

test("only the host can change lobby settings and a change clears readiness", () => {
  const { manager } = makeManager();
  const created = manager.createRoom("设置房主");
  const guest = manager.joinRoom(created.room.code, "设置访客");
  manager.setReady(created.room.code, created.player.id);
  manager.setReady(created.room.code, guest.player.id);

  const updated = manager.updateSettings(created.room.code, created.player.id, "hard", "extended");
  assert.equal(updated.room.mode, "hard");
  assert.equal(updated.room.pool, "hardcore");
  assert.equal(updated.room.maxGuesses, 4);
  assert.deepEqual(manager.publicState(updated.room).players.map((player) => player.ready), [false, false]);
  assert.throws(() => manager.updateSettings(created.room.code, guest.player.id, "normal", "normal"), /只有房主/);

  manager.setReady(created.room.code, created.player.id);
  manager.setReady(created.room.code, guest.player.id);
  manager.startRoom(created.room.code, created.player.id);
  assert.throws(() => manager.updateSettings(created.room.code, created.player.id, "normal", "normal"), /准备阶段/);
});

test("first correct guess wins and progress is broadcast as player:progress", () => {
  const { manager } = makeManager();
  const { created, joined } = readyRoom(manager);
  const wrong = songsJson.items.find((song) => song.bvid !== created.room.answerBvid).bvid;
  const wrongResult = manager.submitGuess(created.room.code, created.player.id, wrong);
  assert.equal(wrongResult.room.status, "playing");
  assert.equal(eventOf(wrongResult, "guess:result").data.correct, false);
  assert.equal(eventOf(wrongResult, "player:progress").data.attempts, 1);

  const winResult = manager.submitGuess(created.room.code, joined[0].player.id, created.room.answerBvid);
  assert.equal(winResult.room.status, "ended");
  assert.equal(winResult.room.winnerPlayerId, joined[0].player.id);
  const ended = eventOf(winResult, "round:ended");
  assert.equal(ended.data.reason, "correct");
  assert.equal(ended.data.answer.bvid, created.room.answerBvid);
});

test("hard rooms end after four wrong guesses", () => {
  const { manager } = makeManager();
  const { created } = readyRoom(manager, ["困难甲", "困难乙"], "hard");
  assert.equal(created.room.maxGuesses, 4);
  const wrongBvids = songsJson.items.filter((song) => song.bvid !== created.room.answerBvid).slice(0, 4).map((song) => song.bvid);
  let lastResult;
  for (const bvid of wrongBvids) lastResult = manager.submitGuess(created.room.code, created.player.id, bvid);
  assert.equal(created.room.players.get(created.player.id).finished, true);
  assert.equal("titleHints" in eventOf(lastResult, "guess:result").data, false);
});

test("normal rooms keep a sixth attempt without revealing title characters", () => {
  const { manager } = makeManager();
  const { created } = readyRoom(manager);
  const wrongBvids = songsJson.items.filter((song) => song.bvid !== created.room.answerBvid).slice(0, 5).map((song) => song.bvid);
  let fifth;
  for (const bvid of wrongBvids) fifth = manager.submitGuess(created.room.code, created.player.id, bvid);
  assert.equal(created.room.players.get(created.player.id).finished, false);
  assert.equal("titleHints" in eventOf(fifth, "guess:result").data, false);
});

test("clue ladder shares stages, hides guesses, and allows same-stage winners", () => {
  const { manager } = makeManager();
  const created = manager.createRoom("阶梯甲", "normal", "private", "clue-host", "normal", "clues");
  const guest = manager.joinRoom(created.room.code, "阶梯乙", "clue-guest");
  manager.setReady(created.room.code, created.player.id);
  manager.setReady(created.room.code, guest.player.id);
  manager.startRoom(created.room.code, created.player.id);
  manager.startPlaying(created.room.code);

  const active = manager.publicState(created.room);
  assert.equal(active.gameType, "clues");
  assert.equal(active.maxGuesses, 6);
  assert.equal(active.clueStage, 1);
  assert.equal(active.clues.length, 1);
  assert.equal(active.answer, undefined);

  const wrong = songsJson.items.find((song) => song.bvid !== created.room.answerBvid).bvid;
  const first = manager.submitClueAction(created.room.code, created.player.id, "guess", wrong);
  assert.equal(eventOf(first, "round:ended"), undefined);
  assert.equal(eventOf(first, "clue:submitted").target, created.player.id);
  assert.equal(eventOf(first, "clue:submitted").data.correct, undefined);
  assert.equal(manager.publicState(created.room).players.find((player) => player.id === created.player.id).clueSubmitted, true);

  manager.submitClueAction(created.room.code, guest.player.id, "skip");
  assert.equal(manager.publicState(created.room).clueStage, 2);

  for (const player of [created.player, guest.player]) {
    manager.submitClueAction(created.room.code, player.id, "skip");
  }
  for (const player of [created.player, guest.player]) {
    manager.submitClueAction(created.room.code, player.id, "skip");
  }
  const answer = created.room.answerBvid;
  manager.submitClueAction(created.room.code, created.player.id, "guess", answer);
  const ended = manager.submitClueAction(created.room.code, guest.player.id, "guess", answer);
  const result = eventOf(ended, "round:ended").data;
  assert.equal(ended.room.status, "ended");
  assert.deepEqual(new Set(result.winnerPlayerIds), new Set([created.player.id, guest.player.id]));
  assert.equal(result.players.find((player) => player.id === created.player.id).clueActions.length, 4);
  assert.equal(manager.publicState(created.room).answer.bvid, answer);
});

test("clue ladder timer resolution enters the next stage and final miss draws", () => {
  const { manager, advance } = makeManager();
  const created = manager.createRoom("计时甲", "normal", "private", "timer-host", "normal", "clues");
  const guest = manager.joinRoom(created.room.code, "计时乙", "timer-guest");
  manager.setReady(created.room.code, created.player.id);
  manager.setReady(created.room.code, guest.player.id);
  manager.startRoom(created.room.code, created.player.id);
  manager.startPlaying(created.room.code);
  advance(20_000);
  const advanced = manager.resolveClueStageIfReady(created.room.code, true);
  assert.equal(advanced.room.clueStage, 2);
  assert.equal(advanced.room.status, "playing");
  assert.equal(advanced.room.stageEndsAt, 41_000);
  for (let stage = 2; stage <= 6; stage += 1) {
    manager.submitClueAction(created.room.code, created.player.id, "skip");
    const result = manager.submitClueAction(created.room.code, guest.player.id, "skip");
    if (stage < 6) assert.equal(result.room.clueStage, stage + 1);
    else assert.equal(result.room.status, "ended");
  }
  assert.equal(manager.publicState(created.room).winnerPlayerIds.length, 0);
});

test("reconnect returns previous rows but never exposes an active answer", () => {
  const { manager } = makeManager();
  const { created } = readyRoom(manager);
  const wrong = songsJson.items.find((song) => song.bvid !== created.room.answerBvid).bvid;
  manager.submitGuess(created.room.code, created.player.id, wrong);
  manager.disconnect(created.player.id);
  const reconnected = manager.reconnectRoom(created.room.code, created.player.token);
  assert.equal(manager.publicState(reconnected.room).answer, undefined);
  assert.equal(eventOf(reconnected, "round:history").data.rows.length, 1);
  assert.equal(eventOf(reconnected, "round:history").target, created.player.id);
});

test("expired playing guests can recover an idempotent local-loss summary", () => {
  const { manager, advance } = makeManager({ forfeitReceiptTtlMs: 100 });
  const { created, joined } = readyRoom(manager);
  const guest = joined[0].player;
  const guestDeviceId = guest.deviceId;
  const wrong = songsJson.items.find((song) => song.bvid !== created.room.answerBvid).bvid;
  manager.submitGuess(created.room.code, guest.id, wrong);
  manager.disconnect(guest.id);
  manager.expireDisconnected(created.room.code, guest.id);

  assert.deepEqual(manager.forfeitSummary(created.room.code, guest.token, guestDeviceId), {
    roundId: created.room.roundId,
    pool: "normal",
    mode: "normal",
    attempts: 1,
  });
  assert.deepEqual(manager.forfeitSummary(created.room.code, guest.token, guestDeviceId), manager.forfeitSummary(created.room.code, guest.token, guestDeviceId));
  advance(101);
  manager.cleanup();
  assert.equal(manager.forfeitSummary(created.room.code, guest.token, guestDeviceId), null);
});

test("limits rooms to fifteen and cleans up inactive rooms", () => {
  let clock = 10_000;
  let random = 0;
  const manager = createPkManager(songsJson, {
    now: () => clock,
    maxRooms: 15,
    roomTtlMs: 100,
    randomIndex: (max) => random++ % max,
  });
  const rooms = Array.from({ length: 15 }, (_, index) => manager.createRoom(`玩家${index}`));
  assert.equal(manager.roomCount(), 15);
  assert.throws(() => manager.createRoom("第十六个"), /房间已满/);
  clock += 101;
  const expired = manager.cleanup();
  assert.equal(manager.roomCount(), 0);
  assert.equal(expired.length, 15);
  assert.equal(rooms.length, 15);
});

test("expires inactive lobby rooms before active rounds", () => {
  let clock = 10_000;
  const manager = createPkManager(songsJson, {
    now: () => clock,
    roomTtlMs: 1_000,
    lobbyRoomTtlMs: 100,
    randomIndex: () => 0,
  });
  manager.createRoom("等待玩家");
  clock += 101;
  assert.equal(manager.cleanup().length, 1);
});

test("absolute room lifetime cannot be extended by activity", () => {
  let clock = 10_000;
  const manager = createPkManager(songsJson, {
    now: () => clock,
    roomTtlMs: 10_000,
    lobbyRoomTtlMs: 10_000,
    absoluteRoomTtlMs: 200,
  });
  const created = manager.createRoom("房主");
  clock += 150;
  manager.setReady(created.room.code, created.player.id, false);
  clock += 51;
  assert.equal(manager.cleanup().length, 1);
  assert.equal(manager.roomCount(), 0);
});
