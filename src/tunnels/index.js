// Opens whatever the profile needs between us and the database, and returns
// the endpoint to connect to (T6.1).
import net from "node:net";
import { startSsh } from "./ssh.js";
import { startSsm } from "./ssm.js";
import { stopProcess, exited } from "./process.js";
import { resolveSecret as defaultResolveSecret } from "../secrets/index.js";

/**
 * Tunnel types that can be opened. Sources skip profiles that need any other
 * (ADR-19, ADR-39), so a tunnelled profile is never tried as a direct connection.
 */
export const SUPPORTED_TUNNELS = new Set(["ssh", "ssm"]);

/** How long a tunnel may take to come up (logging in, SSO, the SSM plugin). */
export const TUNNEL_TIMEOUT_MS = 30_000;

/** A free port on 127.0.0.1, chosen by the OS. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Where the tunnel leads: the database host without a SQL Server instance
 * name, and its port. An instance's port is found through SQL Server Browser
 * over UDP, which no tunnel carries, so it must be given.
 */
export function remoteOf(profile) {
  const slash = profile.host.indexOf("\\");
  const host = slash === -1 ? profile.host : profile.host.slice(0, slash);
  if (!profile.port) {
    throw new Error(`${profile.host} is a named instance without a port. Through a tunnel the port must be set, because SQL Server Browser can't be reached.`);
  }
  return { host, port: profile.port };
}

/**
 * Waits until the child prints `ready`, or fails with its explanation when it
 * exits, errors or takes too long. Output is kept for the error message.
 */
export function waitUntilReady({ child, ready, explain }, timeoutMs = TUNNEL_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let log = "";
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      // Keep draining, so a chatty child never blocks on a full pipe.
      child.stdout.resume();
      child.stderr.resume();
      error ? reject(error) : resolve();
    };
    const onData = (chunk) => {
      log = (log + chunk).slice(-20_000);
      if (ready.test(log)) finish();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", (error) => finish(new Error(explain(`${log}\n${error.code === "ENOENT" ? "ENOENT" : error.message}`))));
    // `close`, not `exit`: by then all of its output has been read.
    child.once("close", () => finish(new Error(explain(log))));
    const timer = setTimeout(() => finish(new Error(`${explain(log)} (no tunnel after ${timeoutMs / 1000} s)`)), timeoutMs);
  });
}

/** @returns {Promise<{ host, port, tlsServerName, describe, close(): Promise<void> }>} */
export async function openTunnel(profile, { resolveSecret = defaultResolveSecret, timeoutMs = TUNNEL_TIMEOUT_MS } = {}) {
  if (profile.engine === "duckdb") return { host: null, port: null, tlsServerName: null, close: async () => {} };
  const tunnel = profile.tunnel;
  if (!tunnel) return { host: profile.host, port: profile.port, tlsServerName: profile.host, close: async () => {} };
  if (!SUPPORTED_TUNNELS.has(tunnel.type)) throw new Error(`${tunnel.type} tunnels are not supported`);

  const remote = remoteOf(profile);
  const localPort = await freePort();
  let started;
  if (tunnel.type === "ssh") {
    if (!tunnel.host) throw new Error("the SSH tunnel has no host");
    // A key without a passphrase has no keychain entry: that is fine.
    const passphrase = (await resolveSecret(tunnel.secretRef)) || "";
    started = startSsh(tunnel, remote, localPort, { passphrase });
  } else {
    if (!tunnel.target) throw new Error("the SSM tunnel has no target");
    started = startSsm(tunnel, remote, localPort);
  }

  try {
    await waitUntilReady(started, timeoutMs);
  } catch (error) {
    stopProcess(started.child);
    throw error;
  }
  const via = tunnel.type === "ssh" ? `ssh ${tunnel.user ? `${tunnel.user}@` : ""}${tunnel.host}${tunnel.port ? `:${tunnel.port}` : ""}` : `ssm ${tunnel.target}`;
  return {
    host: "127.0.0.1",
    port: localPort,
    // TLS is checked against the real database host, not 127.0.0.1 (T6.7).
    tlsServerName: profile.host,
    describe: `${via} -> ${remote.host}:${remote.port}`,
    async close() {
      stopProcess(started.child);
      await exited(started.child);
    },
  };
}
