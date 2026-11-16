// DBeaver: data-sources.json plus the encrypted credentials-config.json.
import fs from "node:fs";
import crypto from "node:crypto";
import { makeProfile } from "../model.js";
import { inlineSecret } from "../../secrets/index.js";
import { locateDbeaver } from "../../config.js";

// DBeaver's fixed key. The file is AES-128-CBC, with the IV in the first 16 bytes.
const KEY = Buffer.from("babb4a9f774ab853c96c2d653dfe544a", "hex");

export function decryptCredentials(buffer) {
  if (buffer.length < 32) throw new Error("file is too short");
  const decipher = crypto.createDecipheriv("aes-128-cbc", KEY, buffer.subarray(0, 16));
  const text = Buffer.concat([decipher.update(buffer.subarray(16)), decipher.final()]).toString("utf8");
  return JSON.parse(text);
}

/** DBeaver provider/driver -> engine, or a reason the connection is skipped. */
function engineFor(provider, driver = "") {
  switch (provider) {
    case "postgresql":
      return { engine: "postgres" };
    case "sqlserver":
    case "mssql":
      // The same providers also hold Sybase and the old jTDS driver (T3.7).
      if (/sybase/i.test(driver)) return { reason: "Sybase is not supported" };
      if (/jtds/i.test(driver)) return { reason: "the jTDS driver is not supported; switch the connection to Microsoft's driver" };
      return { engine: "mssql" };
    case "duckdb":
      return { engine: "duckdb" };
    default:
      return { reason: `provider '${provider}' is not supported` };
  }
}

const isTrue = (value) => value === true || String(value).toLowerCase() === "true";
const text = (value) => (value == null || value === "" ? null : String(value));

/** Case-insensitive lookup in the driver properties. */
function driverProperty(configuration, key) {
  const properties = configuration.properties ?? {};
  const name = Object.keys(properties).find((k) => k.toLowerCase() === key.toLowerCase());
  return name === undefined ? null : text(properties[name]);
}

/** libpq's spellings, plus the ones DBeaver's other drivers use. */
function namedMode(mode) {
  const lowered = mode.toLowerCase().replace(/_/g, "-");
  const aliases = { allow: "prefer", preferred: "prefer", disabled: "disable", required: "require", "verify-identity": "verify-full" };
  const known = ["disable", "prefer", "require", "verify-ca", "verify-full"];
  // A mode we do not know is treated as the strictest, never as less than asked.
  return aliases[lowered] ?? (known.includes(lowered) ? lowered : "verify-full");
}

/**
 * TLS for a server connection: the SSL tab (an enabled `*_ssl` handler) first,
 * then the `sslmode` driver property. `mode: null` means DBeaver did not say;
 * the driver then falls back to its own rule. Same order as DBDelve's importer.
 */
export function tlsFrom(configuration) {
  const handler = Object.entries(configuration.handlers ?? {}).find(
    ([id, h]) => id.endsWith("_ssl") && isTrue(h?.enabled)
  )?.[1];
  const tab = (key) => text(handler?.properties?.[key]);

  let mode = null;
  const named = tab("sslMode") ?? driverProperty(configuration, "sslmode");
  if (named) mode = namedMode(named);
  else if (isTrue(tab("ssl.verify.server"))) mode = "verify-ca";
  else if (isTrue(tab("ssl.require"))) mode = "require";
  else if (handler) mode = "prefer";

  return { mode, rootCert: tab("ssl.ca.cert") ?? driverProperty(configuration, "sslrootcert") };
}

/** The value of a SQL Server setting from the driver properties or DBeaver's own provider properties. */
function mssqlSetting(configuration, ...names) {
  for (const name of names) {
    const value = driverProperty(configuration, name) ?? text(configuration["provider-properties"]?.[name]);
    if (value != null) return value;
  }
  return null;
}

/**
 * TLS for SQL Server (T3.5). `encrypt=false|optional` turns TLS off;
 * trust-server-certificate is kept as its own flag and wins in the driver.
 * Otherwise the SSL tab / sslmode, and with nothing said, what Microsoft's
 * driver does since 10.2: encrypt and verify. Same as DBDelve's importer.
 */
export function mssqlTlsFrom(configuration) {
  const base = tlsFrom(configuration);
  const encrypt = mssqlSetting(configuration, "encrypt")?.toLowerCase();
  const trustText = mssqlSetting(configuration, "sslTrustServerCertificate", "trustServerCertificate");
  const trustServerCert = trustText == null ? null : isTrue(trustText);
  if (encrypt === "false" || encrypt === "optional" || encrypt === "no") {
    return { mode: "disable", rootCert: null, trustServerCert };
  }
  const mode = base.mode ?? (trustServerCert ? "require" : "verify-full");
  return { mode, rootCert: base.rootCert, trustServerCert };
}

/**
 * A DuckDB connection's file: `configuration.database`, else the JDBC URL
 * without `jdbc:duckdb:` and its `?options`. Null for an in-memory database,
 * which has nothing to share between programs (T4.6).
 */
export function duckdbPath(configuration) {
  let file = text(configuration.database);
  if (!file) {
    const url = text(configuration.url);
    if (url?.toLowerCase().startsWith("jdbc:duckdb:")) file = url.slice("jdbc:duckdb:".length).split("?")[0] || null;
  }
  if (!file || file === ":memory:" || file.startsWith(":memory:")) return null;
  return file;
}

/** Why a SQL Server connection's sign-in can't be used, or null (ADR-5). */
function mssqlAuthProblem(configuration) {
  const model = configuration["auth-model"];
  if (!model || model === "sqlserver_database" || model === "native") return null;
  return `SQL Server sign-in '${model}' is not supported yet (only SQL logins)`;
}

/**
 * Maps parsed data-sources.json + credentials into profiles. Connections we
 * cannot use are returned in `skipped` with the reason. Ids are
 * `<folder>/<name>`; outside the General project they start with
 * `<project>:`, so two projects can hold the same name.
 */
export function mapDbeaver(dataSources, credentials, { project = "General" } = {}) {
  const profiles = [];
  const skipped = [];
  const prefix = project === "General" ? "" : `${project}:`;

  for (const [key, conn] of Object.entries(dataSources.connections ?? {})) {
    const localId = prefix + (conn.folder ? `${conn.folder}/${conn.name}` : conn.name ?? key);
    const skip = (reason) => skipped.push({ id: `dbeaver:${localId}`, source: "dbeaver", reason });

    // A connection made from a template names the real database in original-*.
    const provider = conn["original-provider"] ?? conn.provider;
    const driver = conn["original-driver"] ?? conn.driver;
    const { engine, reason } = engineFor(provider, driver);
    if (!engine) {
      skip(reason);
      continue;
    }
    const configuration = conn.configuration;
    if (!configuration) {
      skip("connection has no configuration");
      continue;
    }

    if (engine === "duckdb") {
      // A local file: no host, no credentials, no network handlers.
      const file = duckdbPath(configuration);
      if (!file) {
        skip("in-memory DuckDB database: nothing to connect to");
        continue;
      }
      profiles.push(
        makeProfile({ source: "dbeaver", localId, engine, name: conn.name, folder: conn.folder ?? null, path: file, readOnly: isTrue(configuration["read-only"]) })
      );
      continue;
    }

    const otherHandlers = Object.entries(configuration.handlers ?? {})
      .filter(([id, h]) => !id.endsWith("_ssl") && isTrue(h?.enabled))
      .map(([id]) => id);
    if (otherHandlers.length) {
      skip(`network handler not supported yet: ${otherHandlers.join(", ")}`);
      continue;
    }

    if (engine === "mssql") {
      const problem = mssqlAuthProblem(configuration);
      if (problem) {
        skip(problem);
        continue;
      }
    }

    const cred = credentials[key]?.["#connection"];
    if (!cred?.user || !cred?.password) {
      skip("no saved user and password");
      continue;
    }

    try {
      profiles.push(
        makeProfile({
          source: "dbeaver",
          localId,
          engine,
          name: conn.name,
          folder: conn.folder ?? null,
          host: configuration.host,
          port: configuration.port,
          database: configuration.database,
          auth: { type: "password", user: cred.user, secretRef: inlineSecret(cred.password) },
          tls: engine === "mssql" ? mssqlTlsFrom(configuration) : tlsFrom(configuration),
          readOnly: isTrue(configuration["read-only"]),
        })
      );
    } catch (error) {
      skip(error.message);
    }
  }
  return { profiles, skipped };
}

function readProject({ project, dataSourcesFiles, credentialsPath }) {
  const profiles = [];
  const skipped = [];
  const errors = [];

  // A missing credentials file just means nothing has a saved password.
  let credentials = {};
  if (fs.existsSync(credentialsPath)) {
    try {
      credentials = decryptCredentials(fs.readFileSync(credentialsPath));
    } catch (error) {
      errors.push(`cannot decrypt ${credentialsPath}: ${error.message}`);
    }
  }
  for (const file of dataSourcesFiles) {
    let dataSources;
    try {
      dataSources = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      errors.push(`cannot read ${file}: ${error.message}`);
      continue;
    }
    const mapped = mapDbeaver(dataSources, credentials, { project });
    profiles.push(...mapped.profiles);
    skipped.push(...mapped.skipped);
  }
  return { profiles, skipped, errors };
}

/**
 * The DBeaver profile source. Files are found and read again on each load,
 * so `reload` picks up new connections. A broken project or file is reported
 * and the rest still load; nothing usable at all is an error.
 */
export function dbeaverSource(locate = () => locateDbeaver()) {
  return {
    name: "dbeaver",
    load() {
      const { location, projects } = locate();
      const result = { location, profiles: [], skipped: [], errors: [] };
      for (const project of projects) {
        const { profiles, skipped, errors } = readProject(project);
        result.profiles.push(...profiles);
        result.skipped.push(...skipped);
        result.errors.push(...errors);
      }
      if (!result.profiles.length && !result.skipped.length && result.errors.length) {
        throw new Error(result.errors.join("; "));
      }
      return result;
    },
  };
}
