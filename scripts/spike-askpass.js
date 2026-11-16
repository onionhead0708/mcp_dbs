#!/usr/bin/env node
// T6.3 spike: does this OS's OpenSSH run our SSH_ASKPASS helper for a key
// passphrase? Uses ssh-keygen, which reads a key's passphrase the same way
// ssh does (read_passphrase), so no server is needed.
//
//   node scripts/spike-askpass.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { askpassProgram } from "../src/tunnels/ssh.js";

const windows = process.platform === "win32";
const bin = (name) => {
  const builtIn = windows && path.join(process.env.SystemRoot || "C:\\Windows", "System32", "OpenSSH", `${name}.exe`);
  return builtIn && fs.existsSync(builtIn) ? builtIn : name;
};
const keygen = bin("ssh-keygen");
const version = spawnSync(bin("ssh"), ["-V"], { encoding: "utf8" });
console.log(`platform: ${process.platform} ${process.arch}; ${(version.stderr || version.stdout).trim()}`);
console.log(`ssh-keygen: ${keygen}`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-dbs-askpass-spike-"));
const key = path.join(dir, "id_ed25519");
const passphrase = `pass with spaces, "quotes", %PATH% & $HOME ${Date.now()}`;
const made = spawnSync(keygen, ["-q", "-t", "ed25519", "-N", passphrase, "-C", "spike", "-f", key], { encoding: "utf8" });
if (made.status !== 0) {
  console.log(`could not make a key: ${made.stderr}`);
  process.exit(2);
}
const expected = fs.readFileSync(`${key}.pub`, "utf8").split(" ").slice(0, 2).join(" ");

const program = askpassProgram();
console.log(`askpass: ${program}`);
const read = (secret) =>
  spawnSync(keygen, ["-y", "-f", key], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, SSH_ASKPASS: program, SSH_ASKPASS_REQUIRE: "force", DISPLAY: process.env.DISPLAY || ":0", MCP_DBS_ASKPASS_SECRET: secret },
    timeout: 20_000,
  });

const right = read(passphrase);
const got = right.stdout.trim().split(" ").slice(0, 2).join(" ");
const rightOk = right.status === 0 && got === expected;
console.log(`right passphrase: ${rightOk ? "OK, key decrypted through askpass" : `FAILED (status ${right.status}) ${right.stderr.trim()}`}`);
const wrong = read("not the passphrase");
const wrongOk = wrong.status !== 0;
console.log(`wrong passphrase: ${wrongOk ? "refused, as it should be" : "ACCEPTED (unexpected)"}`);
fs.rmSync(dir, { recursive: true, force: true });
console.log(`RESULT: ${rightOk && wrongOk ? "PASS" : "FAIL"}`);
process.exit(rightOk && wrongOk ? 0 : 1);
