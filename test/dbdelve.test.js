import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { mapDbdelve, dbdelveSource, engineOf, readOnlyFrom } from "../src/profiles/sources/dbdelve.js";
import { resolveSecret, KeychainSecret } from "../src/secrets/index.js";
import { SUPPORTED_TUNNELS } from "../src/tunnels/index.js";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "dbdelve", "profiles.toml");
const fromFixture = () => ({ profilesPath: fixture, keychainService: "dbdelve" });
const one = (toml, options) => mapDbdelve(parse(toml), options);
const pg = (extra = "") => `[[profiles]]\nid = "p"\nname = "P"\nhost = "db.example.com"\ndatabase = "app"\nuser = "u"\n${extra}`;

test("loads the fixture: SQL Server and DuckDB, other tables ignored", () => {
  const { location, profiles, skipped } = dbdelveSource(fromFixture).load();
  assert.equal(location, fixture);
  assert.deepEqual(skipped, []);
  assert.deepEqual(profiles.map((p) => p.id), ["dbdelve:local-sqlserver", "dbdelve:localtest"]);

  const [mssql, duck] = profiles;
  assert.equal(mssql.engine, "mssql");
  assert.equal(mssql.port, 1433, "no port: the engine default");
  assert.equal(mssql.database, null, "empty: the login's default database");
  assert.equal(mssql.auth.user, "tester");
  assert.deepEqual(mssql.auth.secretRef.toJSON(), { type: "keychain", service: "dbdelve", account: "local-sqlserver" });
  assert.equal(mssql.tls.mode, "prefer");
  assert.equal(mssql.readOnly, false, "mode = full");

  assert.equal(duck.engine, "duckdb");
  assert.equal(duck.path, "/home/user/data/test.duckdb");
  assert.equal(duck.auth, null, "a file has no password, so the keychain is never asked");
  assert.equal(duck.readOnly, false);
});

test("engine: missing means postgres; the SSM table form names the real engine", () => {
  assert.deepEqual(engineOf({}), { slug: "postgres", ssm: false });
  assert.deepEqual(engineOf({ engine: "MSSQL" }), { slug: "mssql", ssm: false });
  assert.deepEqual(engineOf({ engine: { ssm: { engine: "mssql" } } }), { slug: "mssql", ssm: true });
  assert.deepEqual(engineOf({ engine: { ssm: {} } }), { slug: "postgres", ssm: true });
  assert.deepEqual(engineOf({ engine: 42 }), { slug: null, ssm: false });
});

test("Postgres fields: port, sslmode, root certificate, schema", () => {
  const [p] = one(pg('port = 6432\nsslmode = "verify-full"\nroot_certificate = "/certs/ca.pem"\nschema = "reporting"')).profiles;
  assert.equal(p.engine, "postgres");
  assert.equal(p.port, 6432);
  assert.deepEqual(p.tls, { mode: "verify-full", rootCert: "/certs/ca.pem", trustServerCert: null });
  assert.equal(p.schema, "reporting");
  assert.equal(one(pg()).profiles[0].tls.mode, "prefer", "absent predates TLS settings: prefer");
  assert.equal(one(pg('sslmode = "allow"')).profiles[0].tls.mode, "prefer");
  assert.equal(one(pg('sslmode = "sometimes"')).profiles[0].tls.mode, "verify-full", "unknown: strictest");
});

test("mode: only read-only blocks writes; unknown is treated as read-only", () => {
  assert.equal(readOnlyFrom(undefined), false);
  assert.equal(readOnlyFrom("read-write"), false);
  assert.equal(readOnlyFrom("full"), false);
  assert.equal(readOnlyFrom("read-only"), true);
  assert.equal(readOnlyFrom("something-new"), true);
  assert.equal(one(pg('mode = "read-only"')).profiles[0].readOnly, true);
});

test("the variant's keychain service is used", () => {
  const [p] = one(pg(), { keychainService: "dbdelve-dev" }).profiles;
  assert.equal(p.auth.secretRef.service, "dbdelve-dev");
});

test("skip rules: password_command, service file, run_as, unknown engine, plugins (T5.3)", () => {
  const reason = (toml) => one(toml).skipped[0]?.reason;
  assert.match(reason(pg('password_command = "pass show db"')), /password_command.*never runs/);
  assert.equal(one(pg('password_command = ""')).profiles.length, 1, "blank is none");
  assert.match(reason(pg('service = "prod"')), /service file/);
  assert.match(reason(pg('[profiles.ssh]\nhost = "bastion"\nrun_as = "postgres"')), /run_as/);
  assert.match(reason('[[profiles]]\nid = "s"\nengine = "sqlite"\npath = "/x.db"'), /engine 'sqlite' is not supported/);
  assert.match(reason('[[profiles]]\nid = "m"\nengine = "mysql"\nhost = "h"'), /engine 'mysql'/);
  assert.match(reason(pg('speaks = "postgres"\nconnection = "host=x"')), /plugin/);
  assert.match(reason('[[profiles]]\nname = "no id"'), /no id/);
  assert.match(reason('[[profiles]]\nid = "d"\nengine = "duckdb"\npath = ""'), /no file path/);
});

test("SSH and SSM tunnels load now that they are supported; a broken SSM setup is skipped", () => {
  assert.ok(SUPPORTED_TUNNELS.has("ssh") && SUPPORTED_TUNNELS.has("ssm"));
  assert.equal(one(pg('[profiles.ssh]\nhost = "bastion"\nidentity_file = "~/.ssh/id_ed25519"')).profiles[0].tunnel.type, "ssh");
  assert.match(one('[[profiles]]\nid = "s"\nhost = "h"\nengine = { ssm = { engine = "postgres" } }').skipped[0].reason, /no \[profiles.ssm\]/);
  assert.match(one('[[profiles]]\nid = "d"\nengine = "duckdb"\npath = "/x.duckdb"\n[profiles.ssh]\nhost = "b"').skipped[0].reason, /DuckDB file can't be reached through a tunnel/);
});

test("SSH and SSM tunnel fields map onto the profile model", () => {
  const [ssh] = one(pg('[profiles.ssh]\nhost = "bastion"\nport = 2222\nuser = "me"\nidentity_file = "~/.ssh/id_ed25519"')).profiles;
  assert.deepEqual(JSON.parse(JSON.stringify(ssh.tunnel)), {
    type: "ssh", host: "bastion", port: 2222, user: "me", identityFile: "~/.ssh/id_ed25519",
    secretRef: { type: "keychain", service: "dbdelve/ssh-passphrase", account: "p" },
  });
  const [blank] = one(pg('[profiles.ssh]\nhost = "bastion"\nuser = ""')).profiles;
  assert.equal(blank.tunnel.user, null, "blank defers to ~/.ssh/config");
  assert.equal(blank.tunnel.port, null);

  const ssmToml = '[[profiles]]\nid = "s"\nhost = "db.internal"\nport = 1433\nuser = "u"\nengine = { ssm = { engine = "mssql" } }\n[profiles.ssm]\ntarget = "i-0123456789abcdef0"\nprofile = "prod"\nregion = "eu-west-1"';
  const [ssm] = one(ssmToml).profiles;
  assert.equal(ssm.engine, "mssql");
  assert.deepEqual(ssm.tunnel, { type: "ssm", target: "i-0123456789abcdef0", awsProfile: "prod", region: "eu-west-1", awsCli: null, pluginPath: null });
  assert.match(one(pg('[profiles.ssh]\nhost = "b"\n[profiles.ssm]\ntarget = "i-0123456789abcdef0"')).skipped[0].reason, /both/);
});

test("the source reports a missing or broken file", (t) => {
  assert.throws(() => dbdelveSource(() => ({ profilesPath: "/nonexistent/profiles.toml", keychainService: "dbdelve" })).load(), /DBDelve not found/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-dbs-dd-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const broken = path.join(dir, "profiles.toml");
  fs.writeFileSync(broken, "[[profiles]\nid = ");
  assert.throws(() => dbdelveSource(() => ({ profilesPath: broken, keychainService: "dbdelve" })).load(), /cannot read/);
});

test("the keychain is read only at resolve time, through the given reader (T5.4, T5.7)", async () => {
  const calls = [];
  const readKeychain = async (service, account) => (calls.push(`${service}/${account}`), account === "saved" ? "s3cret" : null);
  const { profiles } = mapDbdelve(parse(pg()));
  assert.deepEqual(calls, [], "mapping never touches the keychain");
  assert.ok(profiles[0].auth.secretRef instanceof KeychainSecret);

  assert.equal(await resolveSecret(new KeychainSecret("dbdelve", "saved"), { readKeychain }), "s3cret");
  assert.equal(await resolveSecret(new KeychainSecret("dbdelve", "unsaved"), { readKeychain }), null);
  assert.deepEqual(calls, ["dbdelve/saved", "dbdelve/unsaved"]);
});
