#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import pg from "pg";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import path from "path";

// Suppress all console.log output to avoid interfering with MCP protocol
const originalConsoleLog = console.log;
console.log = function() {
  // Don't write anything to stdout
};

// Load .env file manually without dotenv package (to avoid stdout output)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  const lines = envContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const equalsIndex = trimmed.indexOf('=');
      if (equalsIndex !== -1) {
        const key = trimmed.substring(0, equalsIndex).trim();
        const value = trimmed.substring(equalsIndex + 1).trim();
        // Remove quotes if present
        const cleanValue = value.replace(/^['"]|['"]$/g, '');
        if (!process.env[key]) {
          process.env[key] = cleanValue;
        }
      }
    }
  }
}

const { Client } = pg;

// Cache for profiles - load on first access
let profilesCache = null;
let profilesLoadError = null;

function loadDbeaverProfiles() {
  if (profilesCache) return profilesCache;
  if (profilesLoadError) throw profilesLoadError;
  
  const dataSourcesPath = process.env.DBEAVER_DATA_SOURCES_JSON;
  const credentialsPath = process.env.DBEAVER_CREDENTIALS_CONFIG_JSON;

  if (!dataSourcesPath || !credentialsPath) {
    profilesLoadError = new Error("Missing required env vars: DBEAVER_DATA_SOURCES_JSON and/or DBEAVER_CREDENTIALS_CONFIG_JSON");
    throw profilesLoadError;
  }
  
  if (!fs.existsSync(dataSourcesPath)) {
    profilesLoadError = new Error(`data-sources.json not found at: ${dataSourcesPath}`);
    throw profilesLoadError;
  }
  
  if (!fs.existsSync(credentialsPath)) {
    profilesLoadError = new Error(`credentials-config.json not found at: ${credentialsPath}`);
    throw profilesLoadError;
  }

  let dataSources;
  try {
    dataSources = JSON.parse(fs.readFileSync(dataSourcesPath, "utf8"));
  } catch (e) {
    profilesLoadError = new Error(`Failed to parse data-sources.json: ${e.message}`);
    throw profilesLoadError;
  }

  let credentials;
  try {
    const encrypted = fs.readFileSync(credentialsPath);
    const key = Buffer.from("babb4a9f774ab853c96c2d653dfe544a", "hex");
    const iv = Buffer.alloc(16, 0);
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    const jsonStart = decrypted.indexOf("{");
    if (jsonStart === -1) throw new Error("No JSON object found in decrypted output");
    credentials = JSON.parse(decrypted.slice(jsonStart));
  } catch (e) {
    profilesLoadError = new Error(`Failed to decrypt credentials-config.json: ${e.message}`);
    throw profilesLoadError;
  }

  const profiles = new Map();
  for (const [id, conn] of Object.entries(dataSources.connections || {})) {
    if (conn.provider !== "postgresql") continue;
    const cred = credentials[id]?.["#connection"];
    if (!cred?.user || !cred?.password) continue;
    if (!conn.configuration) continue;
    const { name, folder } = conn;
    const { host, port, database } = conn.configuration;
    const mapKey = folder ? `${folder}/${name}` : name;
    
    // Don't use SSL for localhost or when folder is "local" or "no_ssl"
    const useSSL = !(host === "localhost" || folder === "local" || folder === "no_ssl");
    
    profiles.set(mapKey, {
      host,
      port: Number(port) || 5432,
      database,
      user: cred.user,
      password: cred.password,
      ssl: useSSL ? { rejectUnauthorized: false } : false
    });
  }

  profilesCache = profiles;
  return profiles;
}

async function main() {
  try {
    let currentClient = null;
    let currentProfileId = null;

    const server = new Server(
      { name: "mcp-dbs", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "list_profiles",
          description: "List all available PostgreSQL connection profiles loaded from DBeaver",
          inputSchema: {
            type: "object",
            properties: {}
          }
        },
        {
          name: "connect",
          description: "Connect to a PostgreSQL database using a DBeaver profile name (format: folder/name)",
          inputSchema: {
            type: "object",
            properties: {
              profile_id: { type: "string", description: "Profile key in folder/name format as returned by list_profiles" }
            },
            required: ["profile_id"]
          }
        },
        {
          name: "query",
          description: "Execute a SQL query on the connected database",
          inputSchema: {
            type: "object",
            properties: {
              sql: { type: "string" }
            },
            required: ["sql"]
          }
        },
        {
          name: "execute",
          description: "Execute one or more DDL/DML SQL statements (CREATE, DROP, ALTER, INSERT, UPDATE, DELETE, DO blocks). Returns affected row count or confirmation.",
          inputSchema: {
            type: "object",
            properties: {
              sql: { type: "string", description: "SQL statement(s) to execute. Multiple statements separated by semicolons are supported." }
            },
            required: ["sql"]
          }
        }
      ]
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === "list_profiles") {
        try {
          const profiles = loadDbeaverProfiles();
          const keys = [...profiles.keys()];
          if (keys.length === 0) {
            return { content: [{ type: "text", text: "No PostgreSQL profiles found." }] };
          }
          return { content: [{ type: "text", text: keys.join("\n") }] };
        } catch (error) {
          return { content: [{ type: "text", text: `Error loading profiles: ${error.message}` }], isError: true };
        }
      }

      if (name === "connect") {
        try {
          const profiles = loadDbeaverProfiles();
          const profile = profiles.get(args.profile_id);
          if (!profile) {
            return { content: [{ type: "text", text: `Profile '${args.profile_id}' not found.` }], isError: true };
          }

          if (currentClient) {
            await currentClient.end();
            currentClient = null;
            currentProfileId = null;
          }

          const candidate = new Client(profile);
          try {
            await candidate.connect();
          } catch (e) {
            return { content: [{ type: "text", text: `Connection failed: ${e.message}` }], isError: true };
          }
          currentClient = candidate;
          currentProfileId = args.profile_id;

          return { content: [{ type: "text", text: `Connected to database using profile '${args.profile_id}'` }] };
        } catch (error) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
      }

      if (name === "query") {
        if (!currentClient) {
          return { content: [{ type: "text", text: "No active database connection. Use connect first." }], isError: true };
        }

        try {
          const result = await currentClient.query(args.sql);
          const rows = result.rows || [];
          return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text", text: `Query error: ${e.message}` }], isError: true };
        }
      }

      if (name === "execute") {
        if (!currentClient) {
          return { content: [{ type: "text", text: "No active database connection. Use connect first." }], isError: true };
        }

        try {
          const result = await currentClient.query(args.sql);
          const command = result.command || "OK";
          const rowCount = result.rowCount != null ? result.rowCount : 0;
          return { content: [{ type: "text", text: `${command} — ${rowCount} row(s) affected` }] };
        } catch (e) {
          return { content: [{ type: "text", text: `Execute error: ${e.message}` }], isError: true };
        }
      }

      return { content: [{ type: "text", text: "Unknown tool" }], isError: true };
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    // Write to stderr, not stdout
    console.error("Failed to start MCP server:", error);
    process.exit(1);
  }
}

main();