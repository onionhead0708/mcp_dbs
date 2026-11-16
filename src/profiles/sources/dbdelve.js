// DBDelve: <data_root>/dbdelve[-variant]/profiles.toml, with passwords and
// SSH key passphrases in the OS password store (ADR-3). The field meanings
// follow DBDelve's own `StoredProfile` (src/store.rs).
import fs from "node:fs";
import { parse } from "smol-toml";
import { makeProfile, normalizeTlsMode } from "../model.js";
import { keychainSecret } from "../../secrets/index.js";
import { locateDbdelve } from "../../config.js";
import { SUPPORTED_TUNNELS } from "../../tunnels/index.js";

/** DBDelve engine slugs we have a driver for (T5.2, T3.8, T4.5). */
const ENGINES = { postgres: "postgres", mssql: "mssql", duckdb: "duckdb" };

const text = (value) => (typeof value === "string" && value.trim() !== "" ? value : null);
const isTable = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * `engine` is a slug, missing (which predates a second engine and means
 * Postgres), or `{ ssm = { engine = "…" } }` for a connection made through SSM.
 */
export function engineOf(stored) {
  const engine = stored.engine;
  if (engine === undefined) return { slug: "postgres", ssm: false };
  if (typeof engine === "string") return { slug: engine.trim().toLowerCase(), ssm: false };
  if (isTable(engine) && isTable(engine.ssm)) {
    return { slug: (text(engine.ssm.engine) ?? "postgres").toLowerCase(), ssm: true };
  }
  return { slug: null, ssm: false };
}

/**
 * `mode`: only read-only blocks writes (ADR-8). Absent means read-write, as in
 * DBDelve. A mode this version doesn't know is treated as read-only: safer
 * than guessing it allows writes.
 */
export function readOnlyFrom(mode) {
  if (mode === undefined || mode === null || mode === "") return false;
  const slug = String(mode).toLowerCase();
  if (slug === "read-write" || slug === "full") return false;
  return true;
}

function sshTunnel(ssh, id, service) {
  return {
    type: "ssh",
    host: text(ssh.host),
    // Blank or absent defers to ~/.ssh/config, as DBDelve does.
    port: Number.isInteger(ssh.port) ? ssh.port : null,
    user: text(ssh.user),
    identityFile: text(ssh.identity_file),
    secretRef: keychainSecret(`${service}/ssh-passphrase`, id),
  };
}

function ssmTunnel(ssm) {
  return {
    type: "ssm",
    target: text(ssm.target),
    awsProfile: text(ssm.profile),
    region: text(ssm.region),
    awsCli: text(ssm.aws_cli),
    pluginPath: text(ssm.session_manager_plugin),
  };
}

/** Why a stored profile can't be used, or null. */
function problemWith(stored, slug) {
  if (stored.speaks !== undefined || stored.connection !== undefined) return "plugin connections are not supported";
  if (!slug) return "its engine setting can't be read";
  if (!ENGINES[slug]) return `engine '${slug}' is not supported`;
  if (text(stored.password_command)) return "it uses password_command, which mcp-dbs never runs (ADR-3)";
  if (text(stored.service)) return "it uses a Postgres service file (service), which is not supported";
  if (isTable(stored.ssh) && text(stored.ssh.run_as)) return "its SSH tunnel uses run_as (a Unix socket through sudo), which is not supported";
  if (isTable(stored.ssh) && isTable(stored.ssm)) return "it has both an SSH and an SSM tunnel";
  return null;
}

/**
 * Maps a parsed profiles.toml into profiles. Only `[[profiles]]` is read, and
 * fields we don't use are ignored (T5.1).
 */
export function mapDbdelve(doc, { keychainService = "dbdelve" } = {}) {
  const profiles = [];
  const skipped = [];
  const list = Array.isArray(doc?.profiles) ? doc.profiles : [];

  for (const [index, stored] of list.entries()) {
    const localId = text(stored?.id) ?? `#${index + 1}`;
    const skip = (reason) => skipped.push({ id: `dbdelve:${localId}`, source: "dbdelve", reason });
    if (!isTable(stored) || !text(stored.id)) {
      skip("profile has no id");
      continue;
    }

    const { slug, ssm } = engineOf(stored);
    const problem = problemWith(stored, slug);
    if (problem) {
      skip(problem);
      continue;
    }
    const engine = ENGINES[slug];

    let tunnel = null;
    if (ssm || isTable(stored.ssm)) {
      if (!isTable(stored.ssm)) {
        skip("its engine says SSM but there is no [profiles.ssm] table");
        continue;
      }
      tunnel = ssmTunnel(stored.ssm);
    } else if (isTable(stored.ssh)) {
      tunnel = sshTunnel(stored.ssh, stored.id, keychainService);
    }
    if (tunnel && engine === "duckdb") {
      skip("a DuckDB file can't be reached through a tunnel");
      continue;
    }
    if (tunnel && !SUPPORTED_TUNNELS.has(tunnel.type)) {
      skip(`${tunnel.type.toUpperCase()} tunnels are not supported yet`);
      continue;
    }

    const fields = {
      source: "dbdelve",
      localId: stored.id,
      engine,
      name: text(stored.name) ?? stored.id,
      schema: text(stored.schema),
      readOnly: readOnlyFrom(stored.mode),
      tunnel,
    };
    if (engine === "duckdb") {
      fields.path = text(stored.path);
    } else {
      Object.assign(fields, {
        host: text(stored.host),
        port: stored.port,
        // Empty means the login's default database (T3.6, T5.6).
        database: text(stored.database),
        // The keychain is read only when `connect` runs (T5.4).
        auth: { type: "password", user: text(stored.user), secretRef: keychainSecret(keychainService, stored.id) },
        // Absent predates TLS settings and means prefer, as in DBDelve.
        tls: { mode: normalizeTlsMode(text(stored.sslmode) ?? "prefer"), rootCert: text(stored.root_certificate) },
      });
    }
    try {
      profiles.push(makeProfile(fields));
    } catch (error) {
      skip(error.message);
    }
  }
  return { profiles, skipped };
}

/** The DBDelve profile source, reading profiles.toml again on each load. */
export function dbdelveSource(locate = () => locateDbdelve()) {
  return {
    name: "dbdelve",
    load() {
      const { profilesPath, keychainService } = locate();
      if (!fs.existsSync(profilesPath)) throw new Error(`DBDelve not found (no profiles file at ${profilesPath})`);
      let doc;
      try {
        doc = parse(fs.readFileSync(profilesPath, "utf8"));
      } catch (error) {
        throw new Error(`cannot read ${profilesPath}: ${error.message}`);
      }
      return { location: profilesPath, ...mapDbdelve(doc, { keychainService }) };
    },
  };
}
