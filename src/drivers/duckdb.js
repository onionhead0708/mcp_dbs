// DuckDB: local database files (ADR-7) through @duckdb/node-api.
// The package is an optional dependency with a native binary, loaded only
// when a DuckDB profile connects, so the server runs without it (T4.1).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let api;
async function loadApi() {
  if (!api) {
    try {
      api = await import("@duckdb/node-api");
    } catch (error) {
      throw new Error(
        `DuckDB support is not installed on this platform (${process.platform}-${process.arch}). ` +
          `The optional package @duckdb/node-api could not be loaded: ${error.message}`
      );
    }
  }
  return api;
}

/** `~` expanded, made absolute. */
export function resolvePath(file) {
  if (file === "~") return os.homedir();
  if (/^~[\\/]/.test(file)) return path.join(os.homedir(), file.slice(2));
  return path.resolve(file);
}

/** `access_mode` for the profile: read-only only when it says so (ADR-7). */
export function instanceOptions(profile) {
  return { access_mode: profile.readOnly ? "READ_ONLY" : "READ_WRITE" };
}

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

/** DuckDB's words for "another process has this file": a lock on Linux/macOS, a sharing violation on Windows. */
export const HELD_BY_ANOTHER = /lock|being used by another process/i;

/** A lock or open error, said in words a user can act on (T4.4). */
export function explainOpenError(error, file) {
  const message = error?.message ?? String(error);
  if (HELD_BY_ANOTHER.test(message)) {
    const pid = /PID (\d+)/.exec(message)?.[1];
    return new Error(
      `${file} is open in another program${pid ? ` (process ${pid})` : ""}, and DuckDB lets only one program ` +
        "write to a file at a time. Close it there (in DBDelve or DBeaver, disconnect from it) and connect again. " +
        `DuckDB said: ${message}`
    );
  }
  return new Error(`Cannot open DuckDB file ${file}: ${message}`);
}

function statementName(type) {
  return api?.StatementType?.[type] ?? "OK";
}

export default {
  engine: "duckdb",

  async connect(profile) {
    const { DuckDBInstance } = await loadApi();
    const file = resolvePath(profile.path);
    // Never create an empty database by mistake (T4.5).
    if (!fs.existsSync(file)) throw new Error(`DuckDB file not found: ${file}`);
    if (!fs.statSync(file).isFile()) throw new Error(`Not a DuckDB file: ${file}`);

    let instance;
    try {
      instance = await DuckDBInstance.create(file, instanceOptions(profile));
    } catch (error) {
      throw explainOpenError(error, file);
    }
    const connection = await instance.connect();
    const handle = { instance, connection, file };
    try {
      if (profile.schema) await connection.run(`USE ${quoteIdent(profile.schema)}`);
    } catch (error) {
      this.close(handle);
      throw error;
    }
    return handle;
  },

  /** Rows of the last statement, already JSON-safe (exact BIGINT/DECIMAL, microsecond timestamps). */
  async query(handle, sql) {
    const reader = await handle.connection.runAndReadAll(sql);
    return { rows: reader.getRowObjectsJson() };
  },

  /** Each statement on its own, so every one reports what it changed. */
  async execute(handle, sql) {
    const extracted = await handle.connection.extractStatements(sql);
    const results = [];
    for (let i = 0; i < extracted.count; i++) {
      let result;
      try {
        // Missing tables and other binding errors surface at prepare.
        result = await (await extracted.prepare(i)).run();
      } catch (error) {
        const done = results.length ? ` Statements before it ran: ${results.length}.` : "";
        throw new Error(`statement ${i + 1}: ${error.message}${done}`);
      }
      results.push({ command: statementName(result.statementType), rowCount: result.rowsChanged });
    }
    return results;
  },

  async serverVersion(handle) {
    const reader = await handle.connection.runAndReadAll("SELECT 'DuckDB ' || version() AS version");
    return reader.getRowObjectsJson()[0]?.version ?? null;
  },

  /** Closing the instance releases the file lock. */
  async close(handle) {
    try {
      handle.connection.closeSync();
    } finally {
      handle.instance.closeSync();
    }
  },
};
