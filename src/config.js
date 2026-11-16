// Settings from the environment, and where each tool keeps its files on each
// OS. A `.env` file next to index.js is optional: values already in the
// environment (e.g. set by an MCP client) win.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Reads KEY=VALUE lines into `env` without overwriting existing keys.
 * Parsed by hand because nothing may be written to stdout (dotenv used to).
 */
export function loadEnvFile(file, env = process.env) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals === -1) continue;
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (key && env[key] === undefined) env[key] = value;
  }
}

/** The OS facts the path functions use; tests pass their own. */
export function hostInfo({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  return { platform, env, home, path: platform === "win32" ? path.win32 : path.posix };
}

/** A path from the environment: `~` expanded, empty treated as unset. */
export function envPath(value, host = hostInfo()) {
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();
  if (trimmed === "~") return host.home;
  if (/^~[\\/]/.test(trimmed)) return host.path.join(host.home, trimmed.slice(2));
  return trimmed;
}

// ---------------------------------------------------------------- DBeaver

/** Where DBeaver's workspace usually is, most likely first. */
export function dbeaverWorkspaceCandidates(host = hostInfo()) {
  const { platform, env, home, path: p } = host;
  if (platform === "win32") {
    const appData = env.APPDATA || p.join(home, "AppData", "Roaming");
    return [p.join(appData, "DBeaverData", "workspace6")];
  }
  if (platform === "darwin") return [p.join(home, "Library", "DBeaverData", "workspace6")];
  return [
    p.join(home, ".local", "share", "DBeaverData", "workspace6"),
    p.join(home, ".var", "app", "io.dbeaver.DBeaverCommunity", "data", "DBeaverData", "workspace6"),
    p.join(home, "snap", "dbeaver-ce", "current", ".local", "share", "DBeaverData", "workspace6"),
  ];
}

const DATA_SOURCES = /^data-sources.*\.json$/;

/** data-sources*.json in a folder, with data-sources.json first. */
function dataSourceFiles(dir, fsApi) {
  let names;
  try {
    names = fsApi.readdirSync(dir).filter((name) => DATA_SOURCES.test(name));
  } catch {
    return [];
  }
  return names
    .sort((a, b) => (a === "data-sources.json" ? -1 : b === "data-sources.json" ? 1 : a.localeCompare(b, "en")))
    .map((name) => path.join(dir, name));
}

/**
 * The DBeaver projects in a workspace: every `<project>/.dbeaver/` folder
 * with a data-sources file. Workspaces from before DBeaver 6.1.3 keep one set
 * of files in `.metadata/.plugins/org.jkiss.dbeaver.core/`; that is used only
 * when no project has its own.
 */
export function dbeaverProjects(workspace, fsApi = fs) {
  const projects = [];
  let entries = [];
  try {
    entries = fsApi.readdirSync(workspace, { withFileTypes: true });
  } catch {
    return projects;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(workspace, entry.name, ".dbeaver");
    const files = dataSourceFiles(dir, fsApi);
    if (files.length) {
      projects.push({ project: entry.name, dataSourcesFiles: files, credentialsPath: path.join(dir, "credentials-config.json") });
    }
  }
  if (!projects.length) {
    const legacy = path.join(workspace, ".metadata", ".plugins", "org.jkiss.dbeaver.core");
    const files = dataSourceFiles(legacy, fsApi);
    if (files.length) {
      projects.push({ project: "General", dataSourcesFiles: files, credentialsPath: path.join(legacy, "credentials-config.json") });
    }
  }
  // General first: its ids carry no project name.
  return projects.sort((a, b) => (a.project === "General" ? -1 : b.project === "General" ? 1 : a.project.localeCompare(b.project, "en")));
}

/**
 * Finds DBeaver's files. In order:
 *   1. DBEAVER_DATA_SOURCES_JSON (+ DBEAVER_CREDENTIALS_CONFIG_JSON, which
 *      defaults to credentials-config.json next to it): just those files.
 *   2. DBEAVER_WORKSPACE: every project in that workspace.
 *   3. The first usual workspace location that has any project.
 * Returns { location, projects } or throws saying where it looked.
 */
export function locateDbeaver(host = hostInfo(), fsApi = fs) {
  const { env } = host;
  const dataSources = envPath(env.DBEAVER_DATA_SOURCES_JSON, host);
  const credentials = envPath(env.DBEAVER_CREDENTIALS_CONFIG_JSON, host);
  if (dataSources) {
    return {
      location: dataSources,
      projects: [
        {
          project: "General",
          dataSourcesFiles: [dataSources],
          credentialsPath: credentials ?? path.join(path.dirname(dataSources), "credentials-config.json"),
        },
      ],
    };
  }
  if (credentials) throw new Error("DBEAVER_CREDENTIALS_CONFIG_JSON is set but DBEAVER_DATA_SOURCES_JSON is not");

  const workspace = envPath(env.DBEAVER_WORKSPACE, host);
  if (workspace) {
    const projects = dbeaverProjects(workspace, fsApi);
    if (!projects.length) throw new Error(`no DBeaver connections found in DBEAVER_WORKSPACE (${workspace})`);
    return { location: workspace, projects };
  }

  const candidates = dbeaverWorkspaceCandidates(host);
  for (const candidate of candidates) {
    const projects = dbeaverProjects(candidate, fsApi);
    if (projects.length) return { location: candidate, projects };
  }
  throw new Error(
    `no DBeaver connections found (looked in ${candidates.join(", ")}). ` +
      "Set DBEAVER_WORKSPACE or DBEAVER_DATA_SOURCES_JSON if DBeaver keeps them elsewhere."
  );
}

// ---------------------------------------------------------------- DBDelve

/** `dbdelve`, or `dbdelve-<variant>` when DBDELVE_VARIANT is set (§3.3). */
export function dbdelveName(env = process.env) {
  const variant = env.DBDELVE_VARIANT;
  if (!variant) return "dbdelve";
  if (variant === "." || variant === ".." || /[\\/:\0]/.test(variant)) {
    throw new Error(`DBDELVE_VARIANT '${variant}' cannot be part of a path`);
  }
  return `dbdelve-${variant}`;
}

/** DBDelve's data root, the same way DBDelve's own store.rs finds it. */
export function dbdelveDataRoot(host = hostInfo()) {
  const { platform, env, home, path: p } = host;
  if (platform === "darwin") return p.join(home, "Library", "Application Support");
  if (platform === "win32") return env.APPDATA || p.join(home, "AppData", "Roaming");
  return env.XDG_DATA_HOME || p.join(home, ".local", "share");
}

/** DBDelve's folder and profiles.toml. Throws on a bad DBDELVE_VARIANT. */
export function locateDbdelve(host = hostInfo()) {
  const name = dbdelveName(host.env);
  const directory = host.path.join(dbdelveDataRoot(host), name);
  return { directory, profilesPath: host.path.join(directory, "profiles.toml"), keychainService: name };
}
