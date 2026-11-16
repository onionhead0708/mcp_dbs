// PostgreSQL through node-postgres.
import fs from "node:fs";
import pg from "pg";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const LOCAL_FOLDERS = new Set(["local", "no_ssl"]);

/**
 * The TLS mode to use. When the profile does not say, keep the old rule:
 * no TLS for localhost and the `local`/`no_ssl` folders, otherwise TLS
 * without checking the certificate.
 */
export function effectiveTlsMode(profile) {
  if (profile.tls?.mode) return profile.tls.mode;
  return LOCAL_HOSTS.has(profile.host) || LOCAL_FOLDERS.has(profile.folder) ? "disable" : "require";
}

/** node-postgres's `ssl` option for a TLS mode. */
export function sslOption(mode, { rootCert, servername } = {}) {
  if (mode === "disable") return false;
  if (mode === "prefer" || mode === "require") return { rejectUnauthorized: false };
  const ssl = { rejectUnauthorized: true };
  if (rootCert) ssl.ca = fs.readFileSync(rootCert, "utf8");
  if (servername) ssl.servername = servername;
  // verify-ca checks the chain but not the hostname.
  if (mode === "verify-ca") ssl.checkServerIdentity = () => undefined;
  return ssl;
}

export function clientConfig(profile, endpoint, password, ssl) {
  return {
    host: endpoint.host,
    port: endpoint.port,
    database: profile.database ?? undefined,
    user: profile.auth?.user,
    password,
    ssl,
  };
}

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

async function open(config) {
  const client = new pg.Client(config);
  const handle = { client, lostError: null };
  // Without a listener, a dropped connection would crash the whole server.
  client.on("error", (error) => {
    handle.lostError = error;
  });
  await client.connect();
  return handle;
}

function assertAlive(handle) {
  if (handle.lostError) throw new Error(`Connection lost: ${handle.lostError.message}. Use connect again.`);
}

/** pg returns an array of results for a multi-statement string. */
const asList = (result) => (Array.isArray(result) ? result : [result]);

export default {
  engine: "postgres",

  async connect(profile, endpoint, { password }) {
    const mode = effectiveTlsMode(profile);
    const ssl = sslOption(mode, { rootCert: profile.tls?.rootCert, servername: endpoint.tlsServerName });
    let handle;
    try {
      handle = await open(clientConfig(profile, endpoint, password, ssl));
    } catch (error) {
      // libpq's `prefer`: fall back to plain text when the server has no TLS.
      if (mode !== "prefer" || !/does not support SSL/i.test(error.message)) throw error;
      handle = await open(clientConfig(profile, endpoint, password, false));
    }
    try {
      if (profile.readOnly) await handle.client.query("SET default_transaction_read_only = on");
      if (profile.schema) await handle.client.query(`SET search_path TO ${quoteIdent(profile.schema)}`);
    } catch (error) {
      await handle.client.end().catch(() => {});
      throw error;
    }
    return handle;
  },

  /** Rows of the last statement. */
  async query(handle, sql) {
    assertAlive(handle);
    const results = asList(await handle.client.query(sql));
    return { rows: results.at(-1)?.rows ?? [] };
  },

  /** One entry per statement. */
  async execute(handle, sql) {
    assertAlive(handle);
    const results = asList(await handle.client.query(sql));
    return results.map((r) => ({ command: r.command || "OK", rowCount: r.rowCount ?? 0 }));
  },

  async serverVersion(handle) {
    assertAlive(handle);
    const { rows } = await handle.client.query("SELECT version() AS version");
    return rows[0]?.version ?? null;
  },

  async close(handle) {
    await handle.client.end();
  },
};
