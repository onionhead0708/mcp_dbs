import postgres from "./postgres.js";
import mssql from "./mssql.js";

const drivers = { postgres, mssql };

export function getDriver(engine) {
  const driver = drivers[engine];
  if (!driver) throw new Error(`No driver for engine '${engine}' yet`);
  return driver;
}
