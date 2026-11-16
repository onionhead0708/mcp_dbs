import { test } from "node:test";
import assert from "node:assert/strict";
import { splitGo } from "../src/sql/split-go.js";

const sqls = (script) => splitGo(script).map((b) => b.sql.trim());

test("splits on GO alone on its line, any case, with spaces and a trailing comment", () => {
  assert.deepEqual(sqls("select 1\nGO\nselect 2\n  go  \nselect 3\nGo -- done\nselect 4"), ["select 1", "select 2", "select 3", "select 4"]);
});

test("GO with a count repeats the batch", () => {
  const batches = splitGo("insert t default values\nGO 3\nselect 1");
  assert.deepEqual(batches.map((b) => b.count), [3, 1]);
});

test("records the line each batch starts on", () => {
  assert.deepEqual(splitGo("a\nb\nGO\n\nc\nGO\nd").map((b) => b.line), [1, 4, 7]);
});

test("drops empty batches and handles CRLF", () => {
  assert.deepEqual(sqls("GO\r\n\r\nselect 1\r\nGO\r\nGO\r\n  \r\n"), ["select 1"]);
});

test("no GO means one batch, kept as written", () => {
  assert.deepEqual(splitGo("select 1;\nselect 2;"), [{ sql: "select 1;\nselect 2;", count: 1, line: 1 }]);
});

test("GO that is not alone on its line is not a separator", () => {
  assert.equal(splitGo("select 1 GO\nselect 2\nGO; \ngoto_label:\nGOTO x").length, 1);
});

test("GO inside a string, identifier or comment is not a separator", () => {
  assert.equal(splitGo("select 'a\nGO\nb'").length, 1, "string");
  assert.equal(splitGo("select 'it''s\nGO\nok'").length, 1, "escaped quote");
  assert.equal(splitGo('select 1 as "x\nGO\ny"').length, 1, "quoted identifier");
  assert.equal(splitGo("select 1 as [x\nGO\n]]y]").length, 1, "bracketed identifier with ]]");
  assert.equal(splitGo("/* a\nGO\n*/ select 1").length, 1, "block comment");
  assert.equal(splitGo("/* outer /* inner */\nGO\nstill comment */ select 1").length, 1, "nested block comment");
});

test("a line comment ends at the line end, so GO on the next line splits", () => {
  assert.equal(splitGo("select 1 -- it's a comment with a quote\nGO\nselect 2").length, 2);
  assert.equal(splitGo("select 1 -- /* not a block\nGO\nselect 2").length, 2);
});

test("a string that closes on the GO line's predecessor lets GO split", () => {
  assert.equal(splitGo("select 'a\nb'\nGO\nselect 2").length, 2);
});
