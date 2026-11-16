import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { fileURLToPath } from "node:url";
import { decryptCredentials, mapDbeaver, tlsFrom, dbeaverSource } from "../src/profiles/sources/dbeaver.js";
import { resolveSecret } from "../src/secrets/index.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "dbeaver");
const paths = {
  dataSourcesPath: path.join(fixtures, "data-sources.json"),
  credentialsPath: path.join(fixtures, "credentials-config.json"),
};

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

test("loads the fixture: Postgres with credentials, everything else skipped with a reason", async () => {
  const { profiles, skipped } = dbeaverSource(paths).load();
  assert.deepEqual(profiles.map((p) => p.id).sort(), ["dbeaver:Production/orders-db", "dbeaver:local-postgres"]);

  const local = profiles.find((p) => p.id === "dbeaver:local-postgres");
  assert.equal(local.engine, "postgres");
  assert.equal(local.port, 5432);
  assert.equal(local.database, "appdb");
  assert.equal(local.folder, null);
  assert.equal(local.auth.user, "tester");
  assert.equal(await resolveSecret(local.auth.secretRef), "test-password");

  const reasons = Object.fromEntries(skipped.map((s) => [s.id, s.reason]));
  assert.match(reasons["dbeaver:no-saved-password"], /no saved user/);
  assert.match(reasons["dbeaver:local-sqlserver"], /SQL Server/);
  // The DuckDB name contains "/" and must survive as one id.
  assert.match(reasons["dbeaver:DuckDB@/home/user/data/test.duckdb"], /DuckDB/);
  assert.match(reasons["dbeaver:DBeaver Sample Database (SQLite)"], /sqlite/);
});

test("the password never shows up when a profile is printed", () => {
  const { profiles } = dbeaverSource(paths).load();
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

test("an enabled SSH tunnel is skipped until tunnels are supported", () => {
  const { profiles, skipped } = one(postgres({ handlers: { ssh_tunnel: { enabled: true, properties: {} } } }));
  assert.equal(profiles.length, 0);
  assert.match(skipped[0].reason, /ssh_tunnel/);
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

test("the source reports what is not configured", () => {
  assert.throws(() => dbeaverSource(null).load(), /not configured/);
  assert.throws(() => dbeaverSource({ ...paths, dataSourcesPath: "/nonexistent/x.json" }).load(), /cannot read/);
});

test("a missing credentials file means no saved passwords", () => {
  const { profiles, skipped } = dbeaverSource({ ...paths, credentialsPath: "/nonexistent/c.json" }).load();
  assert.equal(profiles.length, 0);
  assert.ok(skipped.some((s) => s.id === "dbeaver:local-postgres" && /no saved user/.test(s.reason)));
});
