// Logging for people running the server: one line per event on stderr
// (stdout is the MCP channel). MCP_DBS_LOG sets the level: error, warn,
// info (the default) or debug; `off` silences it. Never pass a secret here.
const LEVELS = { off: 0, error: 1, warn: 2, info: 3, debug: 4 };

function threshold() {
  return LEVELS[String(process.env.MCP_DBS_LOG ?? "info").toLowerCase()] ?? LEVELS.info;
}

function write(level, message) {
  if (LEVELS[level] > threshold()) return;
  process.stderr.write(`${new Date().toISOString()} mcp-dbs ${level}: ${message}\n`);
}

export const log = {
  error: (message) => write("error", message),
  warn: (message) => write("warn", message),
  info: (message) => write("info", message),
  debug: (message) => write("debug", message),
};

/**
 * Removes secret values from text before it is shown or logged. Drivers and
 * tools rarely echo a password, but nothing they say should be trusted not to.
 */
export function redact(text, secrets) {
  let out = String(text);
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 3) out = out.split(secret).join("***");
  }
  return out;
}
