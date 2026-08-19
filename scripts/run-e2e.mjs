import { spawn } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const isWindows = process.platform === "win32";
const localBaseUrl = "http://127.0.0.1:3000";
const localPkHealthUrl = "http://127.0.0.1:3001/healthz";
const children = new Set();
let shuttingDown = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function start(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
    windowsHide: true,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

async function waitForHttp(url, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "unknown error";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Local test service exited with code ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 503) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (isWindows) {
    // Stop-Process works in restricted Windows shells where taskkill may return
    // access denied; taskkill remains the fallback for a spawned child tree.
    child.kill();
    await Promise.race([once(child, "exit"), sleep(1_000)]);
    if (child.exitCode === null) {
      const powershell = spawn("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Stop-Process -Id ${child.pid} -Force -ErrorAction SilentlyContinue`,
      ], { stdio: "ignore", windowsHide: true });
      await Promise.race([once(powershell, "exit"), sleep(3_000)]);
    }
    if (child.exitCode === null) {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      await Promise.race([once(killer, "exit"), sleep(3_000)]);
    }
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), sleep(3_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function stopAll() {
  const active = [...children];
  await Promise.all(active.map((child) => stop(child)));
}

async function clearStaleVinextLock() {
  try {
    await fetch(localBaseUrl);
    return;
  } catch {
    // No local dev server is reachable, so a leftover lock is safe to remove.
  }
  await rm(path.join(root, ".vinext", "dev", "lock.json"), { force: true });
}

async function handleSignal(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  await stopAll();
  process.exit(128 + (signal === "SIGINT" ? 2 : 15));
}

process.once("SIGINT", () => { void handleSignal("SIGINT"); });
process.once("SIGTERM", () => { void handleSignal("SIGTERM"); });

const baseUrl = process.env.E2E_BASE_URL ?? localBaseUrl;
let web = null;
let pk = null;
let exitCode = 1;

try {
  if (!process.env.E2E_BASE_URL) {
    const vinextCli = path.join(root, "node_modules", "vinext", "dist", "cli.js");
    web = start(process.execPath, [vinextCli, "dev", "--host", "127.0.0.1", "--port", "3000"]);
    pk = start(process.execPath, [path.join(root, "server", "pk-server.mjs")], {
      PK_HOST: "127.0.0.1",
      PK_PORT: "3001",
      PK_ALLOWED_ORIGINS: "http://127.0.0.1:3000",
      PK_DISCONNECT_GRACE_MS: "500",
    });
    await Promise.all([
      waitForHttp(localBaseUrl, web),
      waitForHttp(localPkHealthUrl, pk),
    ]);
  }

  const playwrightCli = path.join(root, "node_modules", "@playwright", "test", "cli.js");
  const runner = start(process.execPath, [playwrightCli, "test"], { E2E_BASE_URL: baseUrl });
  const [result] = await once(runner, "exit");
  exitCode = typeof result === "number" ? result : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  shuttingDown = true;
  await stopAll();
  if (!process.env.E2E_BASE_URL) await clearStaleVinextLock();
}

process.exitCode = exitCode;
