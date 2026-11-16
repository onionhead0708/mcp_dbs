// The shape every profile source produces (see ROADMAP.md §4).

export const ENGINES = ["postgres", "mssql", "duckdb"];
export const SOURCES = ["dbeaver", "dbdelve"];
export const DEFAULT_PORTS = { postgres: 5432, mssql: 1433 };
/** libpq's names; null means the source did not say. */
export const TLS_MODES = ["disable", "prefer", "require", "verify-ca", "verify-full"];

/**
 * The port to use when none is given. A SQL Server named instance
 * (`host\INSTANCE`) has none: its port is looked up through SQL Server Browser.
 */
function defaultPort(engine, host) {
  if (engine === "mssql" && typeof host === "string" && host.includes("\\")) return null;
  return DEFAULT_PORTS[engine] ?? null;
}

/**
 * Builds a profile and checks it. `localId` is the id inside its source; the
 * full id is `<source>:<localId>` (D2). Throws when a field is invalid.
 */
export function makeProfile(fields) {
  const { source, localId, engine } = fields;
  if (!SOURCES.includes(source)) throw new Error(`unknown source ${source}`);
  if (!localId) throw new Error("profile has no id");
  if (!ENGINES.includes(engine)) throw new Error(`unknown engine ${engine}`);

  const tlsMode = fields.tls?.mode ?? null;
  if (tlsMode !== null && !TLS_MODES.includes(tlsMode)) throw new Error(`unknown SSL mode ${tlsMode}`);

  const profile = {
    id: `${source}:${localId}`,
    source,
    engine,
    name: fields.name ?? localId,
    folder: fields.folder ?? null,
    host: fields.host ?? null,
    port: fields.port == null || fields.port === "" ? defaultPort(engine, fields.host) : Number(fields.port),
    database: fields.database || null,
    path: fields.path ?? null,
    auth: fields.auth ?? null,
    tls: { mode: tlsMode, rootCert: fields.tls?.rootCert ?? null, trustServerCert: fields.tls?.trustServerCert ?? null },
    tunnel: fields.tunnel ?? null,
    schema: fields.schema || null,
    readOnly: Boolean(fields.readOnly),
  };

  if (engine === "duckdb") {
    if (!profile.path) throw new Error("DuckDB profile has no file path");
  } else {
    if (!profile.host) throw new Error("profile has no host");
    const namedInstance = profile.port === null && engine === "mssql";
    if (!namedInstance && (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535)) {
      throw new Error(`invalid port ${fields.port}`);
    }
  }
  return profile;
}

/** What tools show about a profile: never the secret references. */
export function describeProfile(profile) {
  return {
    id: profile.id,
    engine: profile.engine,
    source: profile.source,
    ...(profile.engine === "duckdb"
      ? { path: profile.path }
      : { host: profile.host, port: profile.port, database: profile.database }),
    tunnel: profile.tunnel?.type ?? null,
    readOnly: profile.readOnly,
  };
}
