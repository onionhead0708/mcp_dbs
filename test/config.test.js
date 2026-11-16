import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadEnvFile,
  hostInfo,
  envPath,
  dbeaverWorkspaceCandidates,
  dbeaverProjects,
  locateDbeaver,
  dbdelveName,
  locateDbdelve,
} from "../src/config.js";

const linux = (env = {}) => hostInfo({ platform: "linux", env, home: "/home/user" });
const mac = (env = {}) => hostInfo({ platform: "darwin", env, home: "/Users/user" });
const windows = (env = {}) => hostInfo({ platform: "win32", env, home: "C:\\Users\\user" });

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-dbs-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function touch(...parts) {
  const file = path.join(...parts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{}");
  return file;
}

test(".env: CRLF, BOM, quotes, comments; never overrides the environment", (t) => {
  const file = path.join(tempDir(t), ".env");
  fs.writeFileSync(file, '\uFEFFA=1\r\n# comment\r\nB="two words"\r\nC=\'x=y\'\r\nKEEP=from-file\r\n\r\nbroken line\r\n');
  const env = { KEEP: "from-env" };
  loadEnvFile(file, env);
  assert.deepEqual(env, { A: "1", B: "two words", C: "x=y", KEEP: "from-env" });
  loadEnvFile(path.join(path.dirname(file), "missing.env"), env); // no throw
});

test("envPath expands ~ and treats blank as unset", () => {
  assert.equal(envPath("~/x/y.json", linux()), "/home/user/x/y.json");
  assert.equal(envPath("~\\x\\y.json", windows()), "C:\\Users\\user\\x\\y.json");
  assert.equal(envPath("  ", linux()), null);
  assert.equal(envPath(undefined, linux()), null);
  assert.equal(envPath("/abs/path", linux()), "/abs/path");
});

test("DBeaver workspace locations on each OS", () => {
  assert.deepEqual(dbeaverWorkspaceCandidates(linux()), [
    "/home/user/.local/share/DBeaverData/workspace6",
    "/home/user/.var/app/io.dbeaver.DBeaverCommunity/data/DBeaverData/workspace6",
    "/home/user/snap/dbeaver-ce/current/.local/share/DBeaverData/workspace6",
  ]);
  assert.deepEqual(dbeaverWorkspaceCandidates(mac()), ["/Users/user/Library/DBeaverData/workspace6"]);
  assert.deepEqual(dbeaverWorkspaceCandidates(windows({ APPDATA: "D:\\Roaming" })), ["D:\\Roaming\\DBeaverData\\workspace6"]);
  assert.deepEqual(dbeaverWorkspaceCandidates(windows()), ["C:\\Users\\user\\AppData\\Roaming\\DBeaverData\\workspace6"]);
});

test("finds every project's data-sources files, General first", (t) => {
  const ws = tempDir(t);
  touch(ws, "Work", ".dbeaver", "data-sources.json");
  touch(ws, "General", ".dbeaver", "data-sources-2.json");
  touch(ws, "General", ".dbeaver", "data-sources.json");
  touch(ws, "Empty", ".dbeaver", "other.json");
  touch(ws, ".metadata", ".plugins", "org.jkiss.dbeaver.core", "data-sources.json");
  const projects = dbeaverProjects(ws);
  assert.deepEqual(projects.map((p) => p.project), ["General", "Work"]);
  assert.deepEqual(projects[0].dataSourcesFiles.map((f) => path.basename(f)), ["data-sources.json", "data-sources-2.json"]);
  assert.equal(projects[0].credentialsPath, path.join(ws, "General", ".dbeaver", "credentials-config.json"));
});

test("falls back to the pre-6.1.3 layout only when no project has files", (t) => {
  const ws = tempDir(t);
  const legacy = touch(ws, ".metadata", ".plugins", "org.jkiss.dbeaver.core", "data-sources.json");
  const [project] = dbeaverProjects(ws);
  assert.equal(project.project, "General");
  assert.deepEqual(project.dataSourcesFiles, [legacy]);
});

test("a missing workspace has no projects", () => {
  assert.deepEqual(dbeaverProjects("/nonexistent/workspace6"), []);
});

test("locateDbeaver: explicit files, then DBEAVER_WORKSPACE, then the usual places", (t) => {
  const home = tempDir(t);
  // The real platform, so the paths it builds match the files made here.
  const host = (env) => hostInfo({ env, home });

  const files = locateDbeaver(host({ DBEAVER_DATA_SOURCES_JSON: "/x/data-sources.json" }));
  assert.equal(files.projects[0].credentialsPath, path.join("/x", "credentials-config.json"));
  assert.throws(() => locateDbeaver(host({ DBEAVER_CREDENTIALS_CONFIG_JSON: "/x/c.json" })), /DATA_SOURCES_JSON is not/);

  assert.throws(() => locateDbeaver(host({})), /no DBeaver connections found \(looked in .*workspace6/);

  const usual = dbeaverWorkspaceCandidates(host({})).at(-1);
  touch(usual, "General", ".dbeaver", "data-sources.json");
  assert.equal(locateDbeaver(host({})).location, usual);

  const custom = path.join(home, "custom-ws");
  assert.throws(() => locateDbeaver(host({ DBEAVER_WORKSPACE: custom })), /DBEAVER_WORKSPACE/);
  touch(custom, "General", ".dbeaver", "data-sources.json");
  assert.equal(locateDbeaver(host({ DBEAVER_WORKSPACE: custom })).location, custom);
});

test("DBDelve's folder on each OS, with and without a variant", () => {
  assert.equal(locateDbdelve(linux()).profilesPath, "/home/user/.local/share/dbdelve/profiles.toml");
  assert.equal(locateDbdelve(linux({ XDG_DATA_HOME: "/data" })).directory, "/data/dbdelve");
  assert.equal(locateDbdelve(mac()).directory, "/Users/user/Library/Application Support/dbdelve");
  assert.equal(locateDbdelve(windows({ APPDATA: "D:\\Roaming" })).directory, "D:\\Roaming\\dbdelve");
  assert.equal(locateDbdelve(windows()).directory, "C:\\Users\\user\\AppData\\Roaming\\dbdelve");
  const dev = locateDbdelve(linux({ DBDELVE_VARIANT: "dev" }));
  assert.equal(dev.directory, "/home/user/.local/share/dbdelve-dev");
  assert.equal(dev.keychainService, "dbdelve-dev");
  const pinned = locateDbdelve(linux({ DBDELVE_PROFILES: "~/x/profiles.toml", DBDELVE_VARIANT: "dev" }));
  assert.equal(pinned.profilesPath, "/home/user/x/profiles.toml");
  assert.equal(pinned.keychainService, "dbdelve-dev", "the keychain still follows the variant");
});

test("a DBDELVE_VARIANT that is not a safe folder name is refused", () => {
  assert.equal(dbdelveName({}), "dbdelve");
  assert.equal(dbdelveName({ DBDELVE_VARIANT: "" }), "dbdelve");
  for (const bad of ["..", "a/b", "a\\b", "c:"]) assert.throws(() => dbdelveName({ DBDELVE_VARIANT: bad }), /cannot be part of a path/);
});
