#!/usr/bin/env node
// T5.5 spike: can @napi-rs/keyring read the passwords DBDelve saved?
//
//   node scripts/spike-keychain.js            # every profile in DBDelve's profiles.toml
//   node scripts/spike-keychain.js <id> ...   # only these profile ids
//
// Never prints a secret: only whether one was found and its length.
// DBDelve writes with the Rust `keyring` crate v4; @napi-rs/keyring wraps v3.
// On macOS the keychain may ask whether `node` may read each item: allow it.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { Entry, findCredentials } from "@napi-rs/keyring";
import { locateDbdelve } from "../src/config.js";

const linux = process.platform === "linux";
// Without this, a missing Secret Service silently falls back to the kernel
// keyring and every lookup would look like "no entry".
const options = linux ? { linux: { store: "secret-service" } } : undefined;

/** [[profiles]] ids and whether each has an [profiles.ssh] table. Crude, but no TOML dependency yet. */
function readProfiles(file) {
  const profiles = [];
  let current = null;
  let table = null;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const header = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/);
    if (header) {
      table = header[1];
      if (table === "profiles") profiles.push((current = { id: null, engine: "postgres", ssh: false, passwordCommand: false }));
      if (table === "profiles.ssh" && current) current.ssh = true;
      continue;
    }
    if (table !== "profiles" || !current) continue;
    const kv = line.match(/^\s*([A-Za-z_]+)\s*=\s*"((?:[^"\\]|\\.)*)"/);
    if (!kv) continue;
    if (kv[1] === "id") current.id = kv[2];
    if (kv[1] === "engine") current.engine = kv[2];
    if (kv[1] === "password_command") current.passwordCommand = true;
  }
  return profiles.filter((p) => p.id);
}

function read(service, account) {
  try {
    const value = new Entry(service, account, options).getPassword();
    return value == null ? { status: "MISSING" } : { status: "FOUND", length: value.length };
  } catch (error) {
    return { status: "ERROR", message: error.message };
  }
}

/** What the OS itself says is stored, with secret values removed. */
function osView(service, account) {
  try {
    if (linux) {
      const out = execFileSync("secret-tool", ["search", "--all", "service", service], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return out.split("\n").filter((l) => l && !/^secret\s*=/.test(l)).join("\n    ") || "(nothing)";
    }
    if (process.platform === "darwin") {
      // Without -w/-g, `security` prints the item's attributes, not the password.
      const out = execFileSync("security", ["find-generic-password", "-s", service, "-a", account], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return out.split("\n").filter((l) => /"acct"|"svce"|"labl"|class|keychain:/.test(l)).join("\n    ");
    }
  } catch (error) {
    return `(could not ask the OS: ${(error.stderr || error.message).toString().trim().split("\n")[0]})`;
  }
  return "(no OS tool for this platform)";
}

const { profilesPath, keychainService } = locateDbdelve();
const passphraseService = `${keychainService}/ssh-passphrase`;
console.log(`platform:  ${process.platform} ${process.arch}, node ${process.version}`);
console.log(`profiles:  ${profilesPath}`);
console.log(`services:  ${keychainService}, ${passphraseService}\n`);

// 1. Our library against itself: proves the store works at all.
const probe = new Entry("mcp-dbs-spike", "probe", options);
try {
  probe.setPassword("probe-value");
  const back = probe.getPassword();
  probe.deleteCredential();
  console.log(`self test: ${back === "probe-value" ? "OK (write, read, delete)" : "FAILED (read back something else)"}\n`);
} catch (error) {
  console.log(`self test: ERROR ${error.message}\n  The password store itself is not usable from node; nothing below can work.\n`);
}

// 2. DBDelve's entries.
let profiles;
const wanted = process.argv.slice(2);
if (fs.existsSync(profilesPath)) {
  profiles = readProfiles(profilesPath);
  if (wanted.length) profiles = profiles.filter((p) => wanted.includes(p.id));
} else {
  console.log("profiles.toml not found; checking only the ids given.\n");
  profiles = wanted.map((id) => ({ id, engine: "?", ssh: false, passwordCommand: false }));
}
if (!profiles.length) {
  console.log("No profiles to check. Pass profile ids, or save a password in DBDelve first.");
  process.exit(1);
}

let found = 0;
let expected = 0;
for (const p of profiles) {
  const label = `${p.id} [${p.engine}${p.ssh ? ", ssh" : ""}]`;
  if (p.engine === "duckdb") {
    console.log(`${label}: no password expected (DuckDB)`);
    continue;
  }
  if (p.passwordCommand) {
    console.log(`${label}: uses password_command, skipped (ADR-3)`);
    continue;
  }
  expected++;
  const result = read(keychainService, p.id);
  if (result.status === "FOUND") found++;
  console.log(`${label}: password ${result.status}${result.length != null ? ` (${result.length} chars)` : ""}${result.message ? `: ${result.message}` : ""}`);
  if (result.status !== "FOUND") console.log(`    OS says:\n    ${osView(keychainService, p.id)}`);
  if (p.ssh) {
    const pass = read(passphraseService, p.id);
    console.log(`    ssh key passphrase ${pass.status}${pass.length != null ? ` (${pass.length} chars)` : ""} (MISSING is fine for a key without one)`);
  }
}

// 3. What the library can enumerate under the service (accounts only).
try {
  const accounts = findCredentials(keychainService).map((c) => c.account);
  console.log(`\nfindCredentials(${keychainService}): ${accounts.length ? accounts.join(", ") : "(none)"}`);
} catch (error) {
  console.log(`\nfindCredentials(${keychainService}): ERROR ${error.message}`);
}

console.log(`\nRESULT: ${found}/${expected} saved passwords read.`);
console.log("A profile whose password was never saved in DBDelve shows MISSING; that is not a failure.");
process.exit(expected && found === 0 ? 2 : 0);
