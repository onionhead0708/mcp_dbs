// DuckDB against real temporary files (T4.7).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Session } from "../src/session.js";
import { createHandlers } from "../src/server.js";
import { Registry } from "../src/profiles/registry.js";
import { makeProfile } from "../src/profiles/model.js";
import { explainOpenError, instanceOptions, resolvePath, HELD_BY_ANOTHER } from "../src/drivers/duckdb.js";

let available = true;
try {
  await import("@duckdb/node-api");
} catch {
  available = false;
}
const skip = available ? false : "@duckdb/node-api is not installed on this platform";

let dir;
let file;
let handlers;
const text = (result) => result.content.map((c) => c.text).join("\n");
async function ok(promise) {
  const result = await promise;
  assert.ok(!result.isError, text(result));
  return result;
}
const rowsOf = async (sql) => JSON.parse((await ok(handlers.query({ sql }))).content[0].text);

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-dbs-duck-"));
  file = path.join(dir, "test.duckdb");
  if (skip) return;
  // Make the file the tests open; DuckDB is never asked to create one (T4.5).
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(file);
  const connection = await instance.connect();
  await connection.run("CREATE SCHEMA sales; CREATE TABLE sales.orders (id INTEGER, amount DECIMAL(18,4))");
  connection.closeSync();
  instance.closeSync();

  const duck = (localId, extra = {}) => makeProfile({ source: "dbdelve", localId, engine: "duckdb", path: file, ...extra });
  const registry = new Registry([
    {
      name: "dbdelve",
      load: () => ({
        profiles: [
          duck("rw"),
          duck("ro", { readOnly: true }),
          duck("sales", { schema: "sales" }),
          duck("missing", { path: path.join(dir, "nope.duckdb") }),
        ],
        skipped: [],
      }),
    },
  ]);
  handlers = createHandlers({ registry, session: new Session() });
});

after(async () => {
  await handlers?.disconnect();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("unit: access mode, ~ expansion, lock message", () => {
  assert.deepEqual(instanceOptions({ readOnly: false }), { access_mode: "READ_WRITE" });
  assert.deepEqual(instanceOptions({ readOnly: true }), { access_mode: "READ_ONLY" });
  assert.equal(resolvePath("~/x.duckdb"), path.join(os.homedir(), "x.duckdb"));
  const lock = explainOpenError(new Error('IO Error: Could not set lock on file "/x.duckdb": Conflicting lock is held in /usr/bin/dbdelve (PID 4242)'), "/x.duckdb");
  assert.match(lock.message, /\/x\.duckdb is open in another program \(process 4242\).*disconnect/);
  const windows = explainOpenError(new Error("IO Error: Cannot open file: The process cannot access the file because it is being used by another process."), "C:\\x.duckdb");
  assert.match(windows.message, /is open in another program, and DuckDB/);
});

test("a missing file is refused, never created", { skip }, async () => {
  const result = await handlers.connect({ profile_id: "missing" });
  assert.match(text(result), /DuckDB file not found/);
  assert.equal(fs.existsSync(path.join(dir, "nope.duckdb")), false);
});

test("execute runs several statements and reports each", { skip }, async () => {
  await ok(handlers.connect({ profile_id: "rw" }));
  const result = await ok(
    handlers.execute({
      sql: "CREATE TABLE t (b BIGINT, h HUGEINT, d DECIMAL(38,10), ts TIMESTAMP, l INTEGER[], s STRUCT(a INTEGER, b VARCHAR), m MAP(VARCHAR, INTEGER), bl BLOB);\n" +
        "INSERT INTO t VALUES (9007199254740993, 170141183460469231731687303715884105727, 12345678901234567890.0123456789, '2026-01-02 03:04:05.123456', [1, 2], {'a': 1, 'b': 'x'}, MAP {'k': 2}, '\\xDE\\xAD'::BLOB), (1, 1, 1, NULL, [], NULL, NULL, NULL);\n" +
        "UPDATE t SET b = b + 1 WHERE b = 1",
    })
  );
  assert.deepEqual(text(result).split("\n"), ["CREATE — 0 row(s) affected", "INSERT — 2 row(s) affected", "UPDATE — 1 row(s) affected"]);
});

test("values come back exact: BIGINT, HUGEINT, DECIMAL, microseconds, nested types", { skip }, async () => {
  const [row] = await rowsOf("SELECT * FROM t ORDER BY b DESC LIMIT 1");
  assert.deepEqual(row, {
    b: "9007199254740993",
    h: "170141183460469231731687303715884105727",
    d: "12345678901234567890.0123456789",
    ts: "2026-01-02 03:04:05.123456",
    l: [1, 2],
    s: { a: 1, b: "x" },
    m: [{ key: "k", value: 2 }],
    bl: "\\xDE\\xAD",
  });
});

test("a failing statement says which one", { skip }, async () => {
  const result = await handlers.execute({ sql: "SELECT 1; SELECT * FROM no_such_table" });
  assert.match(text(result), /statement 2: .*no_such_table.*Statements before it ran: 1/s);
});

test("the file is locked while connected and released by disconnect", { skip }, async () => {
  const probe = () => tryOpenInChild(file);
  assert.match(await probe(), HELD_BY_ANOTHER);
  await ok(handlers.disconnect());
  assert.equal(await probe(), "opened");
});

test("a file held by another program gives a clear error", { skip }, async () => {
  const child = holdOpenInChild(file);
  try {
    await child.ready;
    const result = await handlers.connect({ profile_id: "rw" });
    assert.equal(result.isError, true);
    // Linux and macOS name the process; Windows does not.
    assert.match(text(result), /is open in another program( \(process \d+\))?, .*DBDelve or DBeaver/);
  } finally {
    child.process.kill();
    await child.exited;
  }
});

test("read-only opens with access_mode READ_ONLY: writes fail even through query", { skip }, async () => {
  await ok(handlers.connect({ profile_id: "ro" }));
  assert.match(text(await handlers.execute({ sql: "DELETE FROM t" })), /read-only/);
  const result = await handlers.query({ sql: "DELETE FROM t" });
  assert.equal(result.isError, true);
  assert.match(text(result), /read-only/i);
  assert.deepEqual(await rowsOf("SELECT COUNT(*)::INTEGER AS c FROM t"), [{ c: 2 }]);
});

test("schema is applied with USE", { skip }, async () => {
  await ok(handlers.connect({ profile_id: "sales" }));
  assert.deepEqual(await rowsOf("SELECT current_schema() AS s, COUNT(*)::INTEGER AS c FROM orders"), [{ s: "sales", c: 0 }]);
});

test("status shows the DuckDB version and the file", { skip }, async () => {
  const status = JSON.parse(text(await handlers.status()));
  assert.equal(status.engine, "duckdb");
  assert.match(status.serverVersion, /^DuckDB v\d/);
  assert.equal(status.endpoint, file);
});

// ---- helpers: another process holding / probing the file, as DBDelve would.

const childScript = (mode) => `
  const { DuckDBInstance } = await import("@duckdb/node-api");
  try {
    const instance = await DuckDBInstance.create(process.argv[1]);
    ${mode === "hold" ? 'console.log("holding"); setInterval(() => {}, 1000);' : 'instance.closeSync(); console.log("opened");'}
  } catch (error) { console.log(error.message); }
`;

function runChild(mode, target) {
  return spawn(process.execPath, ["--input-type=module", "-e", childScript(mode), target], {
    cwd: path.resolve(import.meta.dirname, ".."),
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function tryOpenInChild(target) {
  return new Promise((resolve) => {
    let out = "";
    const child = runChild("probe", target);
    child.stdout.on("data", (d) => (out += d));
    child.on("exit", () => resolve(out.trim()));
  });
}

function holdOpenInChild(target) {
  const child = runChild("hold", target);
  const ready = new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => (String(d).includes("holding") ? resolve() : reject(new Error(String(d)))));
  });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  return { process: child, ready, exited };
}
