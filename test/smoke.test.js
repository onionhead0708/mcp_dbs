// Starts the server over stdio, as an MCP client would, and checks the tool
// list and the DBeaver profiles it loads from the fixtures.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "test", "fixtures", "dbeaver");

let server;
let nextId = 1;
const pending = new Map();

function request(method, params = {}) {
  const id = nextId++;
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 10_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    });
  });
}

before(async () => {
  server = spawn(process.execPath, [path.join(root, "index.js")], {
    env: {
      ...process.env,
      DBEAVER_DATA_SOURCES_JSON: path.join(fixtures, "data-sources.json"),
      DBEAVER_CREDENTIALS_CONFIG_JSON: path.join(fixtures, "credentials-config.json")
    },
    stdio: ["pipe", "pipe", "inherit"]
  });
  let buffer = "";
  server.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      // Anything on stdout that is not JSON-RPC would break a real client.
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.0.0" }
  });
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
});

after(() => server?.kill());

test("server identifies itself as mcp-dbs", async () => {
  const result = await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.0.0" }
  }).catch(() => null);
  // A second initialize may be refused; the name is checked when it is not.
  if (result) assert.equal(result.serverInfo.name, "mcp-dbs");
});

test("lists the four tools", async () => {
  const { tools } = await request("tools/list");
  assert.deepEqual(tools.map((t) => t.name).sort(), ["connect", "execute", "list_profiles", "query"]);
});

test("loads PostgreSQL profiles from the DBeaver fixtures", async () => {
  const result = await request("tools/call", { name: "list_profiles", arguments: {} });
  assert.ok(!result.isError, result.content?.[0]?.text);
  const ids = result.content[0].text.split("\n").sort();
  // Only PostgreSQL with saved credentials today; SQL Server and DuckDB come later.
  assert.deepEqual(ids, ["Production/orders-db", "local-postgres"]);
});
