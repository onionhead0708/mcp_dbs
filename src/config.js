// Settings from the environment. A `.env` file next to index.js is optional:
// values already in the environment (e.g. set by an MCP client) win.
import fs from "node:fs";

/**
 * Reads KEY=VALUE lines into `env` without overwriting existing keys.
 * Parsed by hand because nothing may be written to stdout (dotenv used to).
 */
export function loadEnvFile(file, env = process.env) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals === -1) continue;
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (key && env[key] === undefined) env[key] = value;
  }
}

/** Paths to DBeaver's files, or null when they are not configured. */
export function dbeaverPaths(env = process.env) {
  const dataSourcesPath = env.DBEAVER_DATA_SOURCES_JSON;
  const credentialsPath = env.DBEAVER_CREDENTIALS_CONFIG_JSON;
  if (!dataSourcesPath && !credentialsPath) return null;
  return { dataSourcesPath, credentialsPath };
}
