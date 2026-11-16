import postgres from "./postgres.js";

const drivers = { postgres };

export function getDriver(engine) {
  const driver = drivers[engine];
  if (!driver) throw new Error(`No driver for engine '${engine}' yet`);
  return driver;
}
