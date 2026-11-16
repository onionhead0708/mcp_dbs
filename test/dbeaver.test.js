import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { fileURLToPath } from "node:url";
import { decryptCredentials, mapDbeaver, tlsFrom, mssqlTlsFrom, duckdbPath, dbeaverSource } from "../src/profiles/sources/dbeaver.js";
import { resolveSecret } from "../src/secrets/index.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "dbeaver");
const paths = {
  dataSourcesPath: path.join(fixtures, "data-sources.json"),
  credentialsPath: path.join(fixtures, "credentials-config.json"),
};
const fromFiles = ({ dataSourcesPath, credentialsPath }) => () => ({
  location: dataSourcesPath,
  projects: [{ project: "General", dataSourcesFiles: [dataSourcesPath], credentialsPath }],
});

const postgres = (configuration, extra = {}) => ({
  provider: "postgresql",
  name: "db",
  configuration: { host: "db.example.com", port: "5432", database: "app", ...configuration },
  ...extra,
});
const creds = { c: { "#connection": { user: "u", password: "p" } } };
const one = (conn, credentials = creds) => mapDbeaver({ connections: { c: conn } }, credentials);

test("decrypts the credentials fixture", () => {
  const credentials = decryptCredentials(fs.readFileSync(paths.credentialsPath));
  assert.equal(credentials["postgres-jdbc-local-1"]["#connection"].user, "tester");
});

test("loads the fixture: Postgres and SQL Server with credentials, DuckDB, the rest skipped with a reason", async () => {
  const { profiles, skipped } = dbeaverSource(fromFiles(paths)).load();
  assert.deepEqual(profiles.map((p) => p.id).sort(), [
    "dbeaver:DuckDB@/home/user/data/test.duckdb",
    "dbeaver:Production/orders-db",
    "dbeaver:local-postgres",
    "dbeaver:local-sqlserver",
  ]);

  // The DuckDB name contains "/" and must survive as one id.
  const duck = profiles.find((p) => p.engine === "duckdb");
  assert.equal(duck.path, "/home/user/data/test.duckdb");
  assert.equal(duck.auth, null);

  const mssql = profiles.find((p) => p.id === "dbeaver:local-sqlserver");
  assert.equal(mssql.engine, "mssql");
  assert.equal(mssql.port, 1433);
  assert.deepEqual(mssql.tls, { mode: "require", rootCert: null, trustServerCert: true });
  assert.equal(await resolveSecret(mssql.auth.secretRef), "test-password-3");

  const local = profiles.find((p) => p.id === "dbeaver:local-postgres");
  assert.equal(local.engine, "postgres");
  assert.equal(local.port, 5432);
  assert.equal(local.database, "appdb");
  assert.equal(local.folder, null);
  assert.equal(local.auth.user, "tester");
  assert.equal(await resolveSecret(local.auth.secretRef), "test-password");

  const reasons = Object.fromEntries(skipped.map((s) => [s.id, s.reason]));
  assert.match(reasons["dbeaver:no-saved-password"], /no saved user/);
  assert.match(reasons["dbeaver:DBeaver Sample Database (SQLite)"], /sqlite/);
});

test("the password never shows up when a profile is printed", () => {
  const { profiles } = dbeaverSource(fromFiles(paths)).load();
  const local = profiles.find((p) => p.id === "dbeaver:local-postgres");
  assert.ok(!JSON.stringify(local).includes("test-password"));
  assert.ok(!util.inspect(local, { depth: 10 }).includes("test-password"));
});

test("a template's original-provider wins over provider", () => {
  const { profiles } = one(postgres({}, { provider: "generic", "original-provider": "postgresql" }));
  assert.equal(profiles[0].engine, "postgres");
});

test("read-only comes from configuration['read-only']", () => {
  assert.equal(one(postgres({ "read-only": true })).profiles[0].readOnly, true);
  assert.equal(one(postgres({})).profiles[0].readOnly, false);
});

test("a missing port means the engine default", () => {
  assert.equal(one(postgres({ port: "" })).profiles[0].port, 5432);
});

const withSsh = (properties, login) =>
  one(postgres({ handlers: { ssh_tunnel: { enabled: true, properties } } }), { c: { "#connection": { user: "u", password: "p" }, ...(login ? { "network/ssh_tunnel": login } : {}) } });

test("SSH tunnel with a key: host, port, user and passphrase from DBeaver (T6.5)", async () => {
  const [p] = withSsh({ host: "bastion.example.com", port: "2222", authType: "PUBLIC_KEY", keyPath: "~/.ssh/id_ed25519" }, { user: "deploy", password: "key-pass" }).profiles;
  assert.equal(p.tunnel.type, "ssh");
  assert.equal(p.tunnel.host, "bastion.example.com");
  assert.equal(p.tunnel.port, 2222);
  assert.equal(p.tunnel.user, "deploy");
  assert.equal(p.tunnel.identityFile, "~/.ssh/id_ed25519");
  assert.equal(await resolveSecret(p.tunnel.secretRef), "key-pass");
  assert.ok(!JSON.stringify(p).includes("key-pass"));
});

test("SSH tunnel through the agent: no key, no passphrase", () => {
  const [p] = withSsh({ host: "bastion", authType: "AGENT" }, { user: "deploy", password: "ignored" }).profiles;
  assert.equal(p.tunnel.identityFile, null);
  assert.equal(p.tunnel.secretRef, null);
  assert.equal(p.tunnel.port, null, "no port: ssh's own default or ~/.ssh/config");
});

test("SSH tunnels skipped with a reason: password login, jump hosts, relative key, no host, other handlers", () => {
  const reason = (properties) => withSsh(properties).skipped[0]?.reason;
  assert.match(reason({ host: "b", authType: "PASSWORD" }), /password.*ADR-11/);
  assert.match(reason({ host: "b", authType: "PUBLIC_KEY", "jumpServer.count": "1" }), /jump server/);
  assert.match(reason({ host: "b", authType: "AGENT", jumpServerEnabled: "true" }), /jump server/);
  assert.match(reason({ host: "b", authType: "PUBLIC_KEY", keyPath: "keys/id" }), /not absolute/);
  assert.match(reason({ authType: "AGENT" }), /no host/);
  assert.equal(withSsh({ host: "b", authType: "PUBLIC_KEY", keyPath: "C:\\keys\\id" }).profiles.length, 1, "a Windows path is absolute");
  const proxied = one(postgres({ handlers: { socks_proxy: { enabled: true } } }));
  assert.match(proxied.skipped[0].reason, /socks_proxy/);
});

test("a disabled SSH tunnel is ignored", () => {
  const { profiles } = one(postgres({ handlers: { ssh_tunnel: { enabled: false } } }));
  assert.equal(profiles.length, 1);
});

test("a connection with a bad port is skipped, not a crash", () => {
  const { profiles, skipped } = one(postgres({ port: "nope" }));
  assert.equal(profiles.length, 0);
  assert.match(skipped[0].reason, /port/);
});

test("TLS: the SSL tab, then the sslmode property, else unknown", () => {
  const tab = (properties, enabled = true) => tlsFrom({ handlers: { postgre_ssl: { enabled, properties } } });
  assert.deepEqual(tab({ sslMode: "verify-full", "ssl.ca.cert": "/certs/ca.pem" }), { mode: "verify-full", rootCert: "/certs/ca.pem" });
  assert.equal(tab({ sslMode: "allow" }).mode, "prefer");
  assert.equal(tab({ sslMode: "something-new" }).mode, "verify-full");
  assert.equal(tab({ "ssl.verify.server": "true" }).mode, "verify-ca");
  assert.equal(tab({ "ssl.require": "true" }).mode, "require");
  assert.equal(tab({}).mode, "prefer");
  assert.equal(tab({ sslMode: "disable" }, false).mode, null);
  assert.equal(tlsFrom({ properties: { SSLMode: "require", sslrootcert: "/ca.pem" } }).mode, "require");
  assert.equal(tlsFrom({ properties: { sslrootcert: "/ca.pem" } }).rootCert, "/ca.pem");
  assert.equal(tlsFrom({}).mode, null);
});

test("the source passes on why DBeaver was not found", () => {
  const notFound = () => { throw new Error("no DBeaver connections found"); };
  assert.throws(() => dbeaverSource(notFound).load(), /no DBeaver connections found/);
  assert.throws(() => dbeaverSource(fromFiles({ ...paths, dataSourcesPath: "/nonexistent/x.json" })).load(), /cannot read/);
});

test("a broken file is reported and the other projects still load", () => {
  const result = dbeaverSource(() => ({
    location: "ws",
    projects: [
      { project: "General", dataSourcesFiles: [paths.dataSourcesPath], credentialsPath: paths.credentialsPath },
      { project: "Work", dataSourcesFiles: ["/nonexistent/data-sources.json"], credentialsPath: "/nonexistent/c.json" },
    ],
  })).load();
  assert.equal(result.profiles.length, 4);
  assert.match(result.errors[0], /cannot read \/nonexistent/);
});

test("ids outside the General project start with the project name", () => {
  const { profiles } = mapDbeaver({ connections: { c: postgres({}, { folder: "Prod" }) } }, creds, { project: "Work" });
  assert.equal(profiles[0].id, "dbeaver:Work:Prod/db");
});

test("a missing credentials file means no saved passwords", () => {
  const { profiles, skipped } = dbeaverSource(fromFiles({ ...paths, credentialsPath: "/nonexistent/c.json" })).load();
  assert.deepEqual(profiles.map((p) => p.engine), ["duckdb"], "DuckDB needs no credentials");
  assert.ok(skipped.some((s) => s.id === "dbeaver:local-postgres" && /no saved user/.test(s.reason)));
});

const mssql = (configuration = {}, extra = {}) => ({
  provider: "sqlserver",
  driver: "microsoft",
  name: "ms",
  configuration: { host: "sql.example.com", port: "1433", database: "app", "auth-model": "sqlserver_database", ...configuration },
  ...extra,
});

test("SQL Server: Sybase, jTDS and non-SQL sign-ins are skipped with a reason", () => {
  assert.match(one(mssql({}, { driver: "jtds_sqlserver" })).skipped[0].reason, /jTDS/);
  assert.match(one(mssql({}, { provider: "mssql", driver: "sybase_jtds" })).skipped[0].reason, /Sybase/);
  assert.match(one(mssql({ "auth-model": "sqlserver_ntlm" })).skipped[0].reason, /sqlserver_ntlm.*not supported/);
  assert.equal(one(mssql({ "auth-model": undefined })).profiles.length, 1);
  assert.equal(one(mssql({}, { provider: "mssql" })).profiles[0].engine, "mssql");
});

test("SQL Server: host\\INSTANCE without a port has no port; empty database is none", () => {
  const [named] = one(mssql({ host: "sql.example.com\\SQLEXPRESS", port: "", database: "" })).profiles;
  assert.equal(named.port, null);
  assert.equal(named.database, null);
  assert.equal(one(mssql({ port: "" })).profiles[0].port, 1433);
});

test("SQL Server TLS: encrypt, trust-server-certificate, the SSL tab, else verify", () => {
  const tls = (configuration) => mssqlTlsFrom(configuration);
  assert.deepEqual(tls({}), { mode: "verify-full", rootCert: null, trustServerCert: null });
  assert.deepEqual(tls({ "provider-properties": { sslTrustServerCertificate: "true" } }), { mode: "require", rootCert: null, trustServerCert: true });
  assert.equal(tls({ properties: { trustServerCertificate: "false" } }).trustServerCert, false);
  assert.equal(tls({ properties: { encrypt: "false" } }).mode, "disable");
  assert.equal(tls({ properties: { Encrypt: "optional" } }).mode, "disable");
  assert.equal(tls({ properties: { sslmode: "verify-ca" } }).mode, "verify-ca");
});

test("DuckDB: path from database or the JDBC URL; in-memory is skipped; read-only kept", () => {
  assert.equal(duckdbPath({ database: "/data/a.duckdb" }), "/data/a.duckdb");
  assert.equal(duckdbPath({ url: "jdbc:duckdb:/data/b.duckdb?access_mode=read_only" }), "/data/b.duckdb");
  assert.equal(duckdbPath({ url: "jdbc:duckdb:" }), null);
  assert.equal(duckdbPath({ database: ":memory:" }), null);
  assert.equal(duckdbPath({ url: "jdbc:duckdb::memory:x" }), null);

  const duck = (configuration) => ({ provider: "duckdb", driver: "duckdb_jdbc", name: "d", configuration });
  assert.match(one(duck({ database: ":memory:" }), {}).skipped[0].reason, /in-memory/);
  const [ro] = one(duck({ database: "/data/a.duckdb", "read-only": true }), {}).profiles;
  assert.equal(ro.readOnly, true);
  // A DuckDB connection made from a template still counts.
  assert.equal(one({ ...duck({ database: "/x.duckdb" }), provider: "generic", "original-provider": "duckdb" }, {}).profiles[0].engine, "duckdb");
});
