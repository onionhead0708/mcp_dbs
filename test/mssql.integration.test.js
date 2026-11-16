// Against a real SQL Server (T3.9). Skipped unless MSSQL_TEST_PASSWORD is set:
//
//   docker run -d --rm -e ACCEPT_EULA=Y -e 'MSSQL_SA_PASSWORD=Test-Passw0rd!' -p 51433:1433 \
//     mcr.microsoft.com/mssql/server:2022-latest
//   MSSQL_TEST_PORT=51433 MSSQL_TEST_PASSWORD='Test-Passw0rd!' npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../src/session.js";
import { createHandlers } from "../src/server.js";
import { Registry } from "../src/profiles/registry.js";
import { makeProfile } from "../src/profiles/model.js";
import { inlineSecret } from "../src/secrets/index.js";

const password = process.env.MSSQL_TEST_PASSWORD;
const skip = password ? false : "set MSSQL_TEST_PASSWORD to run against SQL Server";

const profile = (localId, extra = {}) =>
  makeProfile({
    source: "dbeaver",
    localId,
    engine: "mssql",
    host: process.env.MSSQL_TEST_HOST || "127.0.0.1",
    port: process.env.MSSQL_TEST_PORT || 1433,
    database: "",
    auth: { type: "password", user: process.env.MSSQL_TEST_USER || "sa", secretRef: inlineSecret(password) },
    // The Docker image has a self-signed certificate.
    tls: { mode: "require" },
    ...extra,
  });

let handlers;
const text = (result) => result.content.map((c) => c.text).join("\n");
async function ok(promise) {
  const result = await promise;
  assert.ok(!result.isError, text(result));
  return result;
}
const rowsOf = async (sql, args = {}) => JSON.parse((await ok(handlers.query({ sql, ...args }))).content[0].text);

before(async () => {
  if (skip) return;
  const registry = new Registry([
    {
      name: "dbeaver",
      load: () => ({
        profiles: [
          profile("rw"),
          profile("ro", { readOnly: true }),
          profile("verify", { tls: { mode: "verify-full" } }),
          profile("wrong-password", { auth: { type: "password", user: "sa", secretRef: inlineSecret("nope") } }),
        ],
        skipped: [],
      }),
    },
  ]);
  handlers = createHandlers({ registry, session: new Session() });
  await ok(handlers.connect({ profile_id: "rw" }));
  await ok(
    handlers.execute({
      sql: "IF DB_ID('mcp_dbs_test') IS NOT NULL BEGIN ALTER DATABASE mcp_dbs_test SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE mcp_dbs_test; END\nGO\nCREATE DATABASE mcp_dbs_test",
    })
  );
  await ok(handlers.connect({ profile_id: "rw" }));
});

after(async () => {
  if (skip || !handlers) return;
  await handlers.connect({ profile_id: "rw" });
  await handlers.execute({ sql: "ALTER DATABASE mcp_dbs_test SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE mcp_dbs_test" });
  await handlers.disconnect();
});

test("status shows the SQL Server version", { skip }, async () => {
  const status = JSON.parse(text(await handlers.status()));
  assert.equal(status.engine, "mssql");
  assert.match(status.serverVersion, /Microsoft SQL Server/);
});

test("execute splits on GO, so CREATE PROCEDURE works, and GO n repeats", { skip }, async () => {
  const result = await ok(
    handlers.execute({
      sql: [
        "USE mcp_dbs_test",
        "GO",
        "CREATE TABLE t (id bigint IDENTITY PRIMARY KEY, n decimal(10,2), d datetime2, b varbinary(4), s nvarchar(20))",
        "GO",
        "CREATE PROCEDURE p AS SELECT COUNT(*) AS c FROM t -- must be first in its batch",
        "GO",
        "INSERT t (n, d, b, s) VALUES (1.10, '2026-01-02T03:04:05', 0xDEAD, N'héllo')",
        "GO 3",
      ].join("\n"),
    })
  );
  assert.match(text(result), /batch 4 ×3 — 3 row\(s\) affected/);
});

test("query: JSON-safe values, several result sets, max_rows", { skip }, async () => {
  const [row] = await rowsOf("USE mcp_dbs_test; SELECT TOP 1 id, n, d, b, s FROM t ORDER BY id");
  assert.deepEqual(row, { id: "1", n: 1.1, d: "2026-01-02T03:04:05.000Z", b: "\\xdead", s: "héllo" });

  const sets = await rowsOf("SELECT 1 AS a; SELECT 2 AS b UNION ALL SELECT 3");
  assert.deepEqual(sets, [[{ a: 1 }], [{ b: 2 }, { b: 3 }]]);

  const cut = await ok(handlers.query({ sql: "SELECT 1 AS a UNION ALL SELECT 2; SELECT 3 AS b", max_rows: 1 }));
  assert.match(cut.content[1].text, /result set 1: first 1 of 2 rows/);

  assert.deepEqual(await rowsOf("EXEC mcp_dbs_test.dbo.p"), [{ c: 3 }]);
});

test("the session keeps its state between calls (one connection)", { skip }, async () => {
  await ok(handlers.execute({ sql: "CREATE TABLE #tmp (x int); INSERT #tmp VALUES (42)" }));
  assert.deepEqual(await rowsOf("SELECT x FROM #tmp"), [{ x: 42 }]);
});

test("a failing batch says which one, and where", { skip }, async () => {
  const result = await handlers.execute({ sql: "SELECT 1\nGO\nSELECT * FROM no_such_table" });
  assert.equal(result.isError, true);
  assert.match(text(result), /batch 2 \(line 3\): Invalid object name 'no_such_table'.*Batches before it ran: 1/);
});

test("read-only: execute refused, and writes through query are rolled back", { skip }, async () => {
  await ok(handlers.connect({ profile_id: "ro" }));
  assert.match(text(await handlers.execute({ sql: "DELETE mcp_dbs_test.dbo.t" })), /read-only/);
  const deleted = await rowsOf("DELETE mcp_dbs_test.dbo.t OUTPUT deleted.id");
  assert.equal(deleted.length, 3, "the DELETE ran inside the transaction");
  assert.deepEqual(await rowsOf("SELECT COUNT(*) AS c FROM mcp_dbs_test.dbo.t"), [{ c: 3 }], "and was rolled back");
  await ok(handlers.connect({ profile_id: "rw" }));
});

test("verify-full refuses the self-signed certificate", { skip }, async () => {
  const result = await handlers.connect({ profile_id: "verify" });
  assert.equal(result.isError, true);
  assert.match(text(result), /certificate/i);
  await ok(handlers.connect({ profile_id: "rw" }));
});

test("a wrong password fails without leaking it", { skip }, async () => {
  const result = await handlers.connect({ profile_id: "wrong-password" });
  assert.equal(result.isError, true);
  assert.match(text(result), /Login failed/);
  assert.ok(!text(result).includes("nope"));
  await ok(handlers.connect({ profile_id: "rw" }));
});
