import { test } from "node:test";
import assert from "node:assert/strict";
import { Registry } from "../src/profiles/registry.js";
import { makeProfile, describeProfile } from "../src/profiles/model.js";

const pg = (localId, extra = {}) => makeProfile({ source: "dbeaver", localId, engine: "postgres", host: "h", ...extra });
const duck = (localId) => makeProfile({ source: "dbdelve", localId, engine: "duckdb", path: "/tmp/x.duckdb" });

const source = (name, profiles, skipped = []) => ({ name, load: () => ({ profiles, skipped }) });

test("merges sources, sorts ids and keeps going when a source fails", async () => {
  const registry = new Registry([
    source("dbeaver", [pg("b"), pg("a")]),
    { name: "dbdelve", load: () => { throw new Error("boom"); } },
  ]);
  const { profiles, errors } = await registry.list();
  assert.deepEqual(profiles.map((p) => p.id), ["dbeaver:a", "dbeaver:b"]);
  assert.deepEqual(errors, [{ source: "dbdelve", message: "boom" }]);
});

test("filters by engine and source", async () => {
  const registry = new Registry([source("dbeaver", [pg("a")]), source("dbdelve", [duck("d")])]);
  assert.deepEqual((await registry.list({ engine: "duckdb" })).profiles.map((p) => p.id), ["dbdelve:d"]);
  assert.deepEqual((await registry.list({ source: "dbeaver" })).profiles.map((p) => p.id), ["dbeaver:a"]);
});

test("a duplicate id is skipped, the first one is kept", async () => {
  const first = pg("a", { database: "first" });
  const registry = new Registry([source("dbeaver", [first, pg("a", { database: "second" })])]);
  assert.equal((await registry.get("dbeaver:a")).database, "first");
  assert.match((await registry.list()).skipped[0].reason, /same id/);
});

test("get accepts an unprefixed id when it is unique", async () => {
  const registry = new Registry([source("dbeaver", [pg("Production/orders-db")])]);
  assert.equal((await registry.get("Production/orders-db")).id, "dbeaver:Production/orders-db");
});

test("get refuses an unprefixed id that matches several profiles", async () => {
  const dbdelvePg = makeProfile({ source: "dbdelve", localId: "x", engine: "postgres", host: "h" });
  const registry = new Registry([source("dbeaver", [pg("x")]), source("dbdelve", [dbdelvePg])]);
  await assert.rejects(registry.get("x"), /ambiguous/);
});

test("get explains skipped and missing profiles", async () => {
  const registry = new Registry([
    source("dbeaver", [], [{ id: "dbeaver:s", source: "dbeaver", reason: "no saved user and password" }]),
    { name: "dbdelve", load: () => { throw new Error("boom"); } },
  ]);
  await assert.rejects(registry.get("s"), /skipped: no saved user/);
  await assert.rejects(registry.get("nope"), /not found.*dbdelve: boom/);
});

test("loads once, reload reads again", async () => {
  let loads = 0;
  const registry = new Registry([{ name: "dbeaver", load: () => (loads++, { profiles: [], skipped: [] }) }]);
  await registry.list();
  await registry.list();
  assert.equal(loads, 1);
  await registry.reload();
  assert.equal(loads, 2);
});

test("makeProfile validates and fills defaults", () => {
  assert.equal(pg("a").port, 5432);
  assert.equal(pg("a", { database: "" }).database, null);
  assert.throws(() => pg("a", { host: "" }), /no host/);
  assert.throws(() => pg("a", { port: 70000 }), /invalid port/);
  assert.throws(() => makeProfile({ source: "dbeaver", localId: "a", engine: "oracle", host: "h" }), /unknown engine/);
  assert.throws(() => makeProfile({ source: "dbdelve", localId: "a", engine: "duckdb" }), /file path/);
  assert.throws(() => pg("a", { tls: { mode: "sometimes" } }), /SSL mode/);
});

test("describeProfile leaves out credentials", () => {
  const described = describeProfile(pg("a", { auth: { type: "password", user: "u", secretRef: { type: "x" } } }));
  assert.deepEqual(described, {
    id: "dbeaver:a", engine: "postgres", source: "dbeaver", host: "h", port: 5432, database: null, tunnel: null, readOnly: false,
  });
});

test("sources() says where each source read from, or why it failed", async () => {
  const registry = new Registry([
    { name: "dbeaver", load: () => ({ location: "/ws", profiles: [pg("a")], skipped: [], errors: ["cannot read x"] }) },
    { name: "dbdelve", load: () => { throw new Error("boom"); } },
  ]);
  assert.deepEqual(await registry.sources(), [
    { name: "dbeaver", ok: true, location: "/ws", profiles: 1, skipped: 0, errors: 1 },
    { name: "dbdelve", ok: false, error: "boom" },
  ]);
  assert.deepEqual((await registry.list()).errors.map((e) => e.message), ["cannot read x", "boom"]);
});
