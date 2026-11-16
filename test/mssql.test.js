import { test } from "node:test";
import assert from "node:assert/strict";
import { serverAddress, tlsOptions, poolConfig } from "../src/drivers/mssql.js";
import { authentication, strategyName } from "../src/drivers/mssql-auth.js";
import { makeProfile } from "../src/profiles/model.js";

const profile = (extra = {}) =>
  makeProfile({
    source: "dbeaver",
    localId: "ms",
    engine: "mssql",
    host: "sql.example.com",
    database: "app",
    auth: { type: "password", user: "u" },
    ...extra,
  });

test("host\\\\INSTANCE: an instance without a port, a given port wins", () => {
  assert.deepEqual(serverAddress("sql.example.com", 1433), { server: "sql.example.com", port: 1433 });
  assert.deepEqual(serverAddress("sql.example.com\\SQLEXPRESS", null), { server: "sql.example.com", instanceName: "SQLEXPRESS" });
  assert.deepEqual(serverAddress("sql.example.com\\SQLEXPRESS", 1500), { server: "sql.example.com", port: 1500 });
});

test("TLS mapping (T3.5)", () => {
  const tls = (t) => tlsOptions(profile({ tls: t }));
  assert.deepEqual(tls({ mode: "disable" }), { encrypt: false, trustServerCertificate: false });
  assert.deepEqual(tls({ mode: "prefer" }), { encrypt: true, trustServerCertificate: true });
  assert.deepEqual(tls({ mode: "require" }), { encrypt: true, trustServerCertificate: true });
  assert.deepEqual(tls({ mode: "verify-full" }), { encrypt: true, trustServerCertificate: false });
  assert.deepEqual(tls({ mode: "verify-ca" }), { encrypt: true, trustServerCertificate: false });
  assert.deepEqual(tls({}), { encrypt: true, trustServerCertificate: false }, "nothing said: verify");
  // DBeaver's trust-server-certificate wins over the mode.
  assert.equal(tls({ mode: "verify-full", trustServerCert: true }).trustServerCertificate, true);
  assert.equal(tls({ mode: "require", trustServerCert: false }).trustServerCertificate, false);
});

test("through a tunnel, the certificate is checked against the real host", () => {
  const options = tlsOptions(profile({ tls: { mode: "verify-full" } }), { host: "127.0.0.1", port: 40000, tlsServerName: "sql.example.com" });
  assert.equal(options.serverName, "sql.example.com");
});

test("pool config: one connection, no request timeout, database only when set", () => {
  const config = poolConfig(profile(), { host: "sql.example.com", port: 1433 }, "pw");
  assert.equal(config.server, "sql.example.com");
  assert.equal(config.port, 1433);
  assert.equal(config.database, "app");
  assert.deepEqual(config.pool, { min: 0, max: 1 });
  assert.equal(config.requestTimeout, 0);
  assert.deepEqual(config.authentication, { type: "default", options: { userName: "u", password: "pw" } });

  const noDb = poolConfig(profile({ database: "" }), { host: "h\\INST", port: null }, "pw");
  assert.equal("database" in noDb, false);
  assert.equal("port" in noDb, false);
  assert.equal(noDb.options.instanceName, "INST");
});

test("auth strategies: SQL login now, anything else refused clearly", () => {
  assert.equal(strategyName(profile()), "sql");
  assert.throws(() => authentication(profile({ auth: { type: "entra-default" } })), /'entra-default' is not supported yet/);
  assert.throws(() => authentication(profile({ auth: { type: "password" } }), "pw"), /needs a user name/);
});
