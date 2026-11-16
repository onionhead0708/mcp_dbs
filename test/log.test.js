import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, log } from "../src/log.js";

test("redact removes every occurrence of each secret, but not tiny ones", () => {
  assert.equal(redact("pw hunter2 and hunter2 again", ["hunter2"]), "pw *** and *** again");
  assert.equal(redact("a1 is fine", ["a1"]), "a1 is fine", "too short to redact safely");
  assert.equal(redact("nothing", [undefined, null, ""]), "nothing");
});

test("MCP_DBS_LOG sets the level", (t) => {
  const lines = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => (lines.push(String(chunk)), true);
  const level = process.env.MCP_DBS_LOG;
  t.after(() => {
    process.stderr.write = original;
    if (level === undefined) delete process.env.MCP_DBS_LOG;
    else process.env.MCP_DBS_LOG = level;
  });
  process.env.MCP_DBS_LOG = "warn";
  log.info("hidden");
  log.warn("shown");
  process.env.MCP_DBS_LOG = "off";
  log.error("also hidden");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /mcp-dbs warn: shown\n$/);
});
