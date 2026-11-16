// Microsoft SQL Server through `mssql` (tedious: pure JS, nothing native).
import fs from "node:fs";
import sql from "mssql";
import { authentication } from "./mssql-auth.js";
import { splitGo } from "../sql/split-go.js";

/**
 * `host\INSTANCE` names an instance, whose port SQL Server Browser looks up.
 * tedious refuses both a port and an instance, so a given port wins.
 */
export function serverAddress(host, port) {
  const slash = host.indexOf("\\");
  if (slash === -1) return { server: host, port };
  const server = host.slice(0, slash);
  return port ? { server, port } : { server, instanceName: host.slice(slash + 1) };
}

/**
 * tedious's TLS options (T3.5). The profile's mode, then DBeaver's
 * trust-server-certificate setting, which wins when present. With no mode at
 * all, verify the certificate: that is what Microsoft's own drivers do.
 *   disable          -> no encryption
 *   prefer, require  -> encrypt, trust any certificate
 *   verify-ca/-full  -> encrypt, verify (tedious cannot skip only the
 *                       hostname check, so verify-ca is checked as verify-full)
 */
export function tlsOptions(profile, endpoint = {}) {
  const mode = profile.tls?.mode ?? "verify-full";
  if (mode === "disable") return { encrypt: false, trustServerCertificate: false };
  let trust = mode === "prefer" || mode === "require";
  if (profile.tls?.trustServerCert != null) trust = Boolean(profile.tls.trustServerCert);
  const options = { encrypt: true, trustServerCertificate: trust };
  if (!trust) {
    if (profile.tls?.rootCert) options.cryptoCredentialsDetails = { ca: fs.readFileSync(profile.tls.rootCert, "utf8") };
    // Through a tunnel we connect to 127.0.0.1 but check the real name (T6.7).
    if (endpoint.tlsServerName && endpoint.tlsServerName !== endpoint.host) {
      options.serverName = serverAddress(endpoint.tlsServerName).server;
    }
  }
  return options;
}

export function poolConfig(profile, endpoint, password) {
  const { server, port, instanceName } = serverAddress(endpoint.host, endpoint.port);
  return {
    server,
    ...(port ? { port } : {}),
    // Empty means the login's default database: send none (T3.6).
    ...(profile.database ? { database: profile.database } : {}),
    authentication: authentication(profile, password),
    // One connection, so session state (temp tables, SET options) carries over.
    pool: { min: 0, max: 1 },
    connectionTimeout: 15_000,
    // Queries may run as long as they need, as in DBeaver.
    requestTimeout: 0,
    options: {
      appName: "mcp-dbs",
      ...(instanceName ? { instanceName } : {}),
      ...tlsOptions(profile, endpoint),
    },
  };
}

/** Recordsets -> the driver interface's { rows } or, for several, { resultSets }. */
function shape(result) {
  const sets = result.recordsets ?? [];
  if (sets.length <= 1) return { rows: sets[0] ? [...sets[0]] : [] };
  return { resultSets: sets.map((set) => [...set]) };
}

const sum = (numbers = []) => numbers.reduce((a, b) => a + b, 0);

export default {
  engine: "mssql",

  async connect(profile, endpoint, { password }) {
    const pool = new sql.ConnectionPool(poolConfig(profile, endpoint, password));
    const handle = { pool, readOnly: profile.readOnly, lastError: null };
    // Without a listener, a dropped connection would crash the whole server.
    // The pool opens a new connection on the next request by itself.
    pool.on("error", (error) => {
      handle.lastError = error;
    });
    await pool.connect();
    return handle;
  },

  /**
   * Runs the text as one batch. On a read-only profile it runs inside a
   * transaction that is always rolled back (ADR-18): this stops accidental
   * writes, though a script that COMMITs itself can still get past it.
   */
  async query(handle, text) {
    if (!handle.readOnly) return shape(await handle.pool.request().batch(text));
    const tx = new sql.Transaction(handle.pool);
    await tx.begin();
    try {
      return shape(await new sql.Request(tx).batch(text));
    } finally {
      await tx.rollback().catch(() => {});
    }
  },

  /** Splits on GO (ADR-6) and runs each batch in order, `count` times. */
  async execute(handle, text) {
    const batches = splitGo(text);
    const results = [];
    for (const [index, batch] of batches.entries()) {
      let rowCount = 0;
      try {
        for (let run = 0; run < batch.count; run++) {
          rowCount += sum((await handle.pool.request().batch(batch.sql)).rowsAffected);
        }
      } catch (error) {
        const done = results.length ? ` Batches before it ran: ${results.length}.` : "";
        throw new Error(`batch ${index + 1} (line ${batch.line}): ${error.message}.${done}`);
      }
      results.push({
        command: batches.length > 1 || batch.count > 1 ? `batch ${index + 1}${batch.count > 1 ? ` ×${batch.count}` : ""}` : "OK",
        rowCount,
      });
    }
    return results;
  },

  async serverVersion(handle) {
    const result = await handle.pool.request().query("SELECT @@VERSION AS version");
    return result.recordset[0]?.version ?? null;
  },

  async close(handle) {
    await handle.pool.close();
  },
};
