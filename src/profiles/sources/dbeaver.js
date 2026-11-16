// DBeaver: data-sources.json plus the encrypted credentials-config.json.
import fs from "node:fs";
import crypto from "node:crypto";
import { makeProfile } from "../model.js";
import { inlineSecret } from "../../secrets/index.js";

// DBeaver's fixed key. The file is AES-128-CBC, with the IV in the first 16 bytes.
const KEY = Buffer.from("babb4a9f774ab853c96c2d653dfe544a", "hex");

export function decryptCredentials(buffer) {
  if (buffer.length < 32) throw new Error("file is too short");
  const decipher = crypto.createDecipheriv("aes-128-cbc", KEY, buffer.subarray(0, 16));
  const text = Buffer.concat([decipher.update(buffer.subarray(16)), decipher.final()]).toString("utf8");
  return JSON.parse(text);
}

/** DBeaver provider -> engine, or a reason the connection is skipped. */
function engineFor(provider) {
  switch (provider) {
    case "postgresql":
      return { engine: "postgres" };
    case "sqlserver":
    case "mssql":
      return { reason: "SQL Server is not supported yet" };
    case "duckdb":
      return { reason: "DuckDB is not supported yet" };
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

/**
 * Maps parsed data-sources.json + credentials into profiles. Connections we
 * cannot use are returned in `skipped` with the reason.
 */
export function mapDbeaver(dataSources, credentials) {
  const profiles = [];
  const skipped = [];

  for (const [key, conn] of Object.entries(dataSources.connections ?? {})) {
    const localId = conn.folder ? `${conn.folder}/${conn.name}` : conn.name ?? key;
    const skip = (reason) => skipped.push({ id: `dbeaver:${localId}`, source: "dbeaver", reason });

    // A connection made from a template names the real database in original-*.
    const provider = conn["original-provider"] ?? conn.provider;
    const { engine, reason } = engineFor(provider);
    if (!engine) {
      skip(reason);
      continue;
    }
    const configuration = conn.configuration;
    if (!configuration) {
      skip("connection has no configuration");
      continue;
    }

    const otherHandlers = Object.entries(configuration.handlers ?? {})
      .filter(([id, h]) => !id.endsWith("_ssl") && isTrue(h?.enabled))
      .map(([id]) => id);
    if (otherHandlers.length) {
      skip(`network handler not supported yet: ${otherHandlers.join(", ")}`);
      continue;
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
          tls: tlsFrom(configuration),
          readOnly: isTrue(configuration["read-only"]),
        })
      );
    } catch (error) {
      skip(error.message);
    }
  }
  return { profiles, skipped };
}

/** The DBeaver profile source, reading the two files on each load. */
export function dbeaverSource(paths) {
  return {
    name: "dbeaver",
    load() {
      if (!paths) {
        throw new Error("not configured: set DBEAVER_DATA_SOURCES_JSON and DBEAVER_CREDENTIALS_CONFIG_JSON");
      }
      const { dataSourcesPath, credentialsPath } = paths;
      if (!dataSourcesPath) throw new Error("DBEAVER_DATA_SOURCES_JSON is not set");
      if (!credentialsPath) throw new Error("DBEAVER_CREDENTIALS_CONFIG_JSON is not set");

      let dataSources;
      try {
        dataSources = JSON.parse(fs.readFileSync(dataSourcesPath, "utf8"));
      } catch (error) {
        throw new Error(`cannot read data-sources.json at ${dataSourcesPath}: ${error.message}`);
      }
      let credentials = {};
      if (fs.existsSync(credentialsPath)) {
        try {
          credentials = decryptCredentials(fs.readFileSync(credentialsPath));
        } catch (error) {
          throw new Error(`cannot decrypt credentials-config.json at ${credentialsPath}: ${error.message}`);
        }
      }
      // A missing credentials file just means nothing has a saved password.
      return mapDbeaver(dataSources, credentials);
    },
  };
}
