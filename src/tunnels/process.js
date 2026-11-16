// Child processes behind tunnels (ssh, aws + session-manager-plugin): start
// them so the whole tree can be stopped, and stop every one when the server
// exits (T6.1, roadmap risk "Tunnel processes left running").
import { spawn, spawnSync } from "node:child_process";

const windows = process.platform === "win32";
const running = new Set();

/**
 * Starts a tracked child. On Linux/macOS it leads its own process group, so
 * stopping it also stops what it started (aws starts session-manager-plugin).
 */
export function startProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
    detached: !windows,
    windowsHide: true,
  });
  running.add(child);
  child.once("exit", () => running.delete(child));
  child.once("error", () => running.delete(child));
  return child;
}

/** Stops a child and everything it started. Safe to call twice. */
export function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) {
    running.delete(child);
    return;
  }
  try {
    if (windows) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // Already gone.
    }
  }
  running.delete(child);
}

/** Resolves when the child has exited (at once if it already has). */
export function exited(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

// `exit` handlers must be synchronous; both ways of stopping are.
process.on("exit", () => {
  for (const child of running) stopProcess(child);
});

/** For tests. */
export function runningCount() {
  return running.size;
}
