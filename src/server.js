// The MCP tools. index.js builds the registry and session and starts this.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ENGINES, SOURCES, describeProfile } from "./profiles/model.js";
import { formatRows, toJsonSafe } from "./format.js";

export const VERSION = "1.0.0";

const sqlArg = { type: "string", description: "SQL text" };

export const TOOLS = [
  {
    name: "list_profiles",
    description:
      "List the database connection profiles loaded from DBeaver, with their engine and source. " +
      "Connections that cannot be used are listed under `skipped` with the reason.",
    inputSchema: {
      type: "object",
      properties: {
        engine: { type: "string", enum: ENGINES, description: "Only profiles for this engine" },
        source: { type: "string", enum: SOURCES, description: "Only profiles from this source" },
      },
    },
  },
  {
    name: "connect",
    description: "Connect to a database using a profile id from list_profiles (e.g. dbeaver:folder/name). Closes any current connection first.",
    inputSchema: {
      type: "object",
      properties: { profile_id: { type: "string", description: "Profile id as returned by list_profiles" } },
      required: ["profile_id"],
    },
  },
  {
    name: "query",
    description: "Run a SQL query on the connected database and return the rows as JSON.",
    inputSchema: {
      type: "object",
      properties: {
        sql: sqlArg,
        max_rows: { type: "integer", minimum: 1, description: "Return at most this many rows" },
      },
      required: ["sql"],
    },
  },
  {
    name: "execute",
    description:
      "Execute one or more DDL/DML SQL statements (CREATE, DROP, ALTER, INSERT, UPDATE, DELETE, DO blocks). " +
      "Returns the affected row count. Refused on read-only profiles.",
    inputSchema: {
      type: "object",
      properties: { sql: { ...sqlArg, description: "SQL statement(s). Several statements separated by semicolons are supported." } },
      required: ["sql"],
    },
  },
  {
    name: "disconnect",
    description: "Close the current database connection.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "status",
    description: "Show the current connection: profile, engine, server version and tunnel.",
    inputSchema: { type: "object", properties: {} },
  },
];

const text = (t) => ({ content: [{ type: "text", text: t }] });
const fail = (t) => ({ content: [{ type: "text", text: t }], isError: true });
const json = (value) => text(JSON.stringify(toJsonSafe(value), null, 2));

function requireSql(args) {
  if (typeof args?.sql !== "string" || !args.sql.trim()) throw new Error("`sql` must be a non-empty string");
  return args.sql;
}

/** Tool name -> async (args) => MCP result. Exported for tests. */
export function createHandlers({ registry, session }) {
  return {
    async list_profiles(args = {}) {
      const { profiles, skipped, errors } = await registry.list({ engine: args.engine, source: args.source });
      return json({ profiles: profiles.map(describeProfile), skipped, errors });
    },

    async connect(args = {}) {
      if (typeof args.profile_id !== "string" || !args.profile_id) return fail("`profile_id` is required");
      let profile;
      try {
        profile = await registry.get(args.profile_id);
      } catch (error) {
        return fail(error.message);
      }
      try {
        await session.connect(profile);
      } catch (error) {
        return fail(`Connection failed: ${error.message}`);
      }
      return text(`Connected to '${profile.id}' (${profile.engine}${profile.readOnly ? ", read-only" : ""})`);
    },

    async query(args = {}) {
      const maxRows = args.max_rows;
      if (maxRows != null && (!Number.isInteger(maxRows) || maxRows < 1)) {
        return fail("`max_rows` must be a positive integer");
      }
      try {
        const { rows } = await session.query(requireSql(args));
        const result = formatRows(rows, maxRows);
        const content = [{ type: "text", text: result.text }];
        if (result.truncated) {
          content.push({ type: "text", text: `Showing the first ${result.shown} of ${result.total} rows.` });
        }
        return { content };
      } catch (error) {
        return fail(`Query error: ${error.message}`);
      }
    },

    async execute(args = {}) {
      try {
        const results = await session.execute(requireSql(args));
        return text(results.map((r) => `${r.command} — ${r.rowCount} row(s) affected`).join("\n"));
      } catch (error) {
        return fail(`Execute error: ${error.message}`);
      }
    },

    async disconnect() {
      try {
        const closed = await session.disconnect();
        return text(closed ? `Disconnected from '${closed.id}'` : "No active connection.");
      } catch (error) {
        return fail(`Disconnect error: ${error.message}`);
      }
    },

    async status() {
      return json(await session.status());
    },
  };
}

export function createServer(deps) {
  const handlers = createHandlers(deps);
  const server = new Server({ name: "mcp-dbs", version: VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const handler = handlers[request.params.name];
    if (!handler) return fail(`Unknown tool '${request.params.name}'`);
    try {
      return await handler(request.params.arguments ?? {});
    } catch (error) {
      return fail(`Error: ${error.message}`);
    }
  });
  return server;
}
