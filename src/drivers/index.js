import postgres from "./postgres.js";
import mssql from "./mssql.js";
// Loads @duckdb/node-api only when a DuckDB profile connects.
import duckdb from "./duckdb.js";

const drivers = { postgres, mssql, duckdb };

export function getDriver(engine) {
  const driver = drivers[engine];
  if (!driver) throw new Error(`No driver for engine '${engine}' yet`);
  return driver;
}
