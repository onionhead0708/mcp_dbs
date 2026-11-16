// The session and the tool handlers, with a fake driver instead of a database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../src/session.js";
import { createHandlers } from "../src/server.js";
import { Registry } from "../src/profiles/registry.js";
import { makeProfile } from "../src/profiles/model.js";
import { inlineSecret } from "../src/secrets/index.js";

function setup({ failConnect = false } = {}) {
  const log = [];
  const driver = {
    async connect(profile, endpoint, { password }) {
      log.push(`connect ${profile.id} ${endpoint.host}:${endpoint.port} ${password}`);
      if (failConnect) throw new Error("refused");
      return { id: profile.id };
    },
    async query(handle, sql) {
      return { rows: [{ n: 1n }, { n: 2n }, { n: 3n }] };
    },
    async execute(handle, sql) {
      return [{ command: "INSERT", rowCount: 2 }];
    },
    async serverVersion() {
      return "FakeSQL 1.0";
    },
    async close(handle) {
      log.push(`close ${handle.id}`);
    },
  };
  const tunnel = (profile) => ({
    host: profile.host,
    port: profile.port,
    close: async () => log.push(`tunnel closed ${profile.id}`),
  });
  const session = new Session({ getDriver: () => driver, openTunnel: async (p) => tunnel(p) });
  const profile = (localId, extra = {}) =>
    makeProfile({
      source: "dbeaver",
      localId,
      engine: "postgres",
      host: "db.example.com",
      auth: { type: "password", user: "u", secretRef: inlineSecret("secret") },
      ...extra,
    });
  const registry = new Registry([
    { name: "dbeaver", load: () => ({ profiles: [profile("rw"), profile("ro", { readOnly: true })], skipped: [] }) },
  ]);
  return { log, handlers: createHandlers({ registry, session }), session };
}

const textOf = (result) => result.content.map((c) => c.text).join("\n");

test("query and execute need a connection", async () => {
  const { handlers } = setup();
  assert.match(textOf(await handlers.query({ sql: "select 1" })), /No active database connection/);
  assert.equal((await handlers.execute({ sql: "delete" })).isError, true);
});

test("connect resolves the secret, then query returns JSON-safe rows", async () => {
  const { handlers, log } = setup();
  const connected = await handlers.connect({ profile_id: "rw" });
  assert.match(textOf(connected), /Connected to 'dbeaver:rw'/);
  assert.equal(log[0], "connect dbeaver:rw db.example.com:5432 secret");
  const result = await handlers.query({ sql: "select n" });
  assert.deepEqual(JSON.parse(result.content[0].text), [{ n: "1" }, { n: "2" }, { n: "3" }]);
});

test("max_rows truncates and says how many there were", async () => {
  const { handlers } = setup();
  await handlers.connect({ profile_id: "dbeaver:rw" });
  const result = await handlers.query({ sql: "select n", max_rows: 2 });
  assert.equal(JSON.parse(result.content[0].text).length, 2);
  assert.match(result.content[1].text, /first 2 of 3/);
  assert.equal((await handlers.query({ sql: "x", max_rows: 0 })).isError, true);
});

test("execute is refused on a read-only profile", async () => {
  const { handlers } = setup();
  await handlers.connect({ profile_id: "ro" });
  assert.match(textOf(await handlers.execute({ sql: "delete from t" })), /read-only/);
  await handlers.connect({ profile_id: "rw" });
  assert.equal(textOf(await handlers.execute({ sql: "insert" })), "INSERT — 2 row(s) affected");
});

test("connecting again closes the previous connection and tunnel", async () => {
  const { handlers, log } = setup();
  await handlers.connect({ profile_id: "rw" });
  await handlers.connect({ profile_id: "ro" });
  assert.deepEqual(log.slice(1, 3), ["close dbeaver:rw", "tunnel closed dbeaver:rw"]);
});

test("a failed connect closes the tunnel and leaves no connection", async () => {
  const { handlers, log } = setup({ failConnect: true });
  const result = await handlers.connect({ profile_id: "rw" });
  assert.match(textOf(result), /Connection failed: refused/);
  assert.ok(log.includes("tunnel closed dbeaver:rw"));
  assert.deepEqual(JSON.parse(textOf(await handlers.status())), { connected: false });
});

test("status and disconnect", async () => {
  const { handlers } = setup();
  await handlers.connect({ profile_id: "ro" });
  const status = JSON.parse(textOf(await handlers.status()));
  assert.equal(status.profile, "dbeaver:ro");
  assert.equal(status.serverVersion, "FakeSQL 1.0");
  assert.equal(status.readOnly, true);
  assert.equal(status.endpoint, "db.example.com:5432");
  assert.match(textOf(await handlers.disconnect()), /Disconnected from 'dbeaver:ro'/);
  assert.match(textOf(await handlers.disconnect()), /No active connection/);
});

test("connect explains an unknown profile", async () => {
  const { handlers } = setup();
  const result = await handlers.connect({ profile_id: "nope" });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /not found/);
});
