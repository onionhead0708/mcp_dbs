#!/usr/bin/env node
// MCP wiring only: settings, profile sources, the session, stdio.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// stdout carries MCP messages only; send any stray logging to stderr.
console.log = console.error;

const { loadEnvFile } = await import("./src/config.js");
const { Registry } = await import("./src/profiles/registry.js");
const { dbeaverSource } = await import("./src/profiles/sources/dbeaver.js");
const { Session } = await import("./src/session.js");
const { createServer } = await import("./src/server.js");

loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), ".env"));

const registry = new Registry([dbeaverSource()]);
const session = new Session();

// Close the connection (and later the tunnel) whenever we stop.
let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  await session.disconnect().catch((error) => console.error("Error while disconnecting:", error.message));
  process.exit(code);
}
process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());
process.stdin.on("close", () => shutdown());

try {
  await createServer({ registry, session }).connect(new StdioServerTransport());
} catch (error) {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
}
