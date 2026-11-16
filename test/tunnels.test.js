import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sshArgs, explainSshFailure, askpassProgram } from "../src/tunnels/ssh.js";
import { ssmArgs, explainSsmFailure } from "../src/tunnels/ssm.js";
import { freePort, remoteOf, openTunnel } from "../src/tunnels/index.js";
import { runningCount, startProcess, stopProcess, exited } from "../src/tunnels/process.js";
import { makeProfile } from "../src/profiles/model.js";

const windows = process.platform === "win32";
// Node won't start a .cmd without a shell (CVE-2024-27980); the stand-in aws
// is one on Windows. The real aws CLI is an .exe, and the tree kill is
// covered on Windows by the test below.
const noCmd = windows && "the stand-in aws is a .cmd on Windows";
const here = path.dirname(fileURLToPath(import.meta.url));

test("ssh arguments: keys only, never waits for a prompt without a secret, forward on 127.0.0.1", () => {
  const args = sshArgs({ host: "bastion", port: 2222, user: "deploy", identityFile: "~/.ssh/id" }, { host: "db.internal", port: 5432 }, 40000, { withSecret: false });
  assert.equal(args.at(-1), "deploy@bastion");
  assert.deepEqual(args.slice(args.indexOf("-L"), args.indexOf("-L") + 2), ["-L", "127.0.0.1:40000:db.internal:5432"]);
  assert.ok(args.includes("BatchMode=yes"));
  assert.ok(args.includes("PasswordAuthentication=no") && args.includes("KbdInteractiveAuthentication=no"));
  assert.ok(args.includes("ExitOnForwardFailure=yes"));
  assert.deepEqual(args.slice(args.indexOf("-p"), args.indexOf("-p") + 2), ["-p", "2222"]);
  assert.deepEqual(args.slice(args.indexOf("-i"), args.indexOf("-i") + 2), ["-i", "~/.ssh/id"]);
  assert.ok(!args.some((a) => /StrictHostKeyChecking=no/i.test(a)), "never turns host-key checking off (T6.4)");

  assert.deepEqual(sshArgs({ host: "h" }, { host: "db", port: 1 }, 2, { withSecret: false, configFile: "/tmp/cfg" }).slice(0, 2), ["-F", "/tmp/cfg"]);
  const plain = sshArgs({ host: "alias" }, { host: "db", port: 1 }, 2, { withSecret: true });
  assert.ok(plain.includes("BatchMode=no"));
  assert.ok(!plain.includes("-p") && !plain.includes("-i"));
  assert.equal(plain.at(-1), "alias", "no user: ~/.ssh/config decides");
});

test("ssh failures are explained", () => {
  const t = { host: "bastion", port: 2222, user: "deploy" };
  assert.match(explainSshFailure("debug1: x\nHost key verification failed.", t), /host key for bastion is not known.*`ssh -p 2222 deploy@bastion`/);
  assert.match(explainSshFailure("Load key \"/k\": incorrect passphrase supplied to decrypt private key", t), /passphrase .* did not work/);
  assert.match(explainSshFailure("deploy@bastion: Permission denied (publickey).", t), /refused.*Only keys and ssh-agent/);
  const locked = "debug1: Server accepts key: /k ED25519\ndebug1: No more authentication methods to try.\ndeploy@bastion: Permission denied (publickey).";
  assert.match(explainSshFailure(locked, t, { withSecret: true }), /passphrase did not unlock it/);
  assert.match(explainSshFailure(locked, t, { withSecret: false }), /needs a passphrase, and none is saved/);
  assert.match(explainSshFailure("ssh: Could not resolve hostname bastion: Name or service not known", t), /Cannot reach the SSH host bastion/);
  assert.match(explainSshFailure("", t), /exited without saying why/);
  assert.ok(!explainSshFailure("debug1: Reading configuration data\nboom", t).includes("debug1"));
});

test("the askpass helper answers passphrase prompts only", { skip: windows && "covered by the Windows askpass CI job" }, () => {
  const program = askpassProgram();
  const run = (prompt, secret) =>
    spawnSync(program, [prompt], { env: { ...process.env, MCP_DBS_ASKPASS_SECRET: secret ?? "" }, encoding: "utf8" });
  const ok = run("Enter passphrase for key '/home/user/.ssh/id':", "it's a \"secret\" $HOME");
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, "it's a \"secret\" $HOME\n");
  assert.equal(run("Are you sure you want to continue connecting (yes/no/[fingerprint])?", "s").status, 1, "never answers a host key question");
  assert.equal(run("deploy@bastion's password:", "s").status, 1, "never answers a password prompt");
  assert.equal(run("Enter passphrase for key:", "").status, 1);
  assert.equal(fs.statSync(path.dirname(program)).mode & 0o077, 0, "private folder");
});

test("ssm arguments", () => {
  const args = ssmArgs({ target: "i-0123456789abcdef0", awsProfile: "prod", region: "eu-west-1" }, { host: "db.internal", port: 1433 }, 40000);
  assert.deepEqual(args.slice(0, 6), ["ssm", "start-session", "--target", "i-0123456789abcdef0", "--document-name", "AWS-StartPortForwardingSessionToRemoteHost"]);
  assert.deepEqual(JSON.parse(args[7]), { host: ["db.internal"], portNumber: ["1433"], localPortNumber: ["40000"] });
  assert.deepEqual(args.slice(8), ["--profile", "prod", "--region", "eu-west-1"]);
  assert.equal(ssmArgs({ target: "i-1" }, { host: "h", port: 1 }, 2).length, 8);
});

test("ssm failures are explained", () => {
  const t = { target: "i-0123456789abcdef0", awsProfile: "prod" };
  assert.match(explainSsmFailure("SessionManagerPlugin is not found.", t), /Session Manager plugin is not installed/);
  assert.match(explainSsmFailure("ENOENT", t), /AWS CLI was not found/);
  assert.match(explainSsmFailure("Error when retrieving token from sso: Token has expired and refresh failed", t), /expired for profile prod.*aws sso login --profile prod/);
  assert.match(explainSsmFailure("An error occurred (TargetNotConnected) when calling the StartSession operation", t), /not connected to Session Manager/);
});

test("remote end: the host without an instance name; an instance needs a port", () => {
  const p = (host, port) => makeProfile({ source: "dbdelve", localId: "x", engine: "mssql", host, port });
  assert.deepEqual(remoteOf(p("sql.internal\\SQLEXPRESS", 1500)), { host: "sql.internal", port: 1500 });
  assert.throws(() => remoteOf(p("sql.internal\\SQLEXPRESS")), /named instance without a port/);
});

test("freePort gives a port nothing listens on", async () => {
  const port = await freePort();
  assert.ok(port > 0);
  await new Promise((resolve, reject) => {
    const server = net.createServer().listen(port, "127.0.0.1", () => server.close(resolve)).on("error", reject);
  });
});

// ---- A stand-in `aws`: prints what the real one prints, forwards the local
// port to the "remote" host, and starts a child like session-manager-plugin.

function fakeAws(t, behaviour) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-dbs-aws-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(here, "fixtures", "fake-aws");
  const pidFile = path.join(dir, "plugin.pid");
  const program = path.join(dir, windows ? "aws.cmd" : "aws");
  if (windows) fs.writeFileSync(program, `@"${process.execPath}" "${script}" ${behaviour} "${pidFile}" %*\r\n`);
  else fs.writeFileSync(program, `#!/bin/sh\nexec '${process.execPath}' '${script}' ${behaviour} '${pidFile}' "$@"\n`, { mode: 0o700 });
  return { program, pidFile };
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("SSM tunnel: ready on 'Waiting for connections', forwards, and close stops the whole tree", { skip: noCmd }, async (t) => {
  // The "database": echoes a greeting.
  const db = net.createServer((socket) => socket.end("hello from db\n"));
  await new Promise((resolve) => db.listen(0, "127.0.0.1", resolve));
  t.after(() => db.close());
  const { program, pidFile } = fakeAws(t, "ok");
  const profile = makeProfile({
    source: "dbdelve", localId: "s", engine: "postgres", host: "127.0.0.1", port: db.address().port,
    tunnel: { type: "ssm", target: "i-0123456789abcdef0", awsProfile: null, region: null, awsCli: program, pluginPath: null },
  });
  const before = runningCount();
  const endpoint = await openTunnel(profile);
  assert.equal(endpoint.host, "127.0.0.1");
  assert.notEqual(endpoint.port, db.address().port);
  assert.equal(endpoint.tlsServerName, "127.0.0.1");
  assert.match(endpoint.describe, /^ssm i-0123456789abcdef0 -> 127\.0\.0\.1:\d+$/);

  const reply = await new Promise((resolve, reject) => {
    let data = "";
    net.connect(endpoint.port, "127.0.0.1").on("data", (d) => (data += d)).on("end", () => resolve(data)).on("error", reject);
  });
  assert.equal(reply, "hello from db\n");

  const pluginPid = Number(fs.readFileSync(pidFile, "utf8"));
  assert.ok(alive(pluginPid));
  await endpoint.close();
  for (let i = 0; i < 50 && alive(pluginPid); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(alive(pluginPid), false, "the plugin child was stopped too");
  assert.equal(runningCount(), before);
});

test("SSM tunnel: an AWS error is explained and nothing is left running", { skip: noCmd }, async (t) => {
  const { program } = fakeAws(t, "expired");
  const profile = makeProfile({
    source: "dbdelve", localId: "s", engine: "postgres", host: "db.internal", port: 5432,
    tunnel: { type: "ssm", target: "i-0123456789abcdef0", awsProfile: "prod", region: null, awsCli: program, pluginPath: null },
  });
  const before = runningCount();
  await assert.rejects(openTunnel(profile), /credentials are missing or expired for profile prod/);
  assert.equal(runningCount(), before);
});

test("SSM tunnel: a missing aws CLI is explained", async () => {
  const profile = makeProfile({
    source: "dbdelve", localId: "s", engine: "postgres", host: "db.internal", port: 5432,
    tunnel: { type: "ssm", target: "i-0123456789abcdef0", awsProfile: null, region: null, awsCli: path.join(os.tmpdir(), "no-such-aws-cli"), pluginPath: null },
  });
  await assert.rejects(openTunnel(profile), /AWS CLI was not found/);
});

test("SSM tunnel: a hung aws times out and is stopped", { skip: noCmd }, async (t) => {
  const { program } = fakeAws(t, "hang");
  const profile = makeProfile({
    source: "dbdelve", localId: "s", engine: "postgres", host: "db.internal", port: 5432,
    tunnel: { type: "ssm", target: "i-0123456789abcdef0", awsProfile: null, region: null, awsCli: program, pluginPath: null },
  });
  const before = runningCount();
  await assert.rejects(openTunnel(profile, { timeoutMs: 1500 }), /no tunnel after 1.5 s/);
  assert.equal(runningCount(), before);
});

test("stopping a process stops what it started (taskkill /T on Windows, the process group elsewhere)", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-dbs-tree-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pidFile = path.join(dir, "grandchild.pid");
  const parent = startProcess(process.execPath, [
    "-e",
    `const { spawn } = require("node:child_process");
     const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
     require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(c.pid));
     console.log("started"); setInterval(() => {}, 1000);`,
  ]);
  await new Promise((resolve) => parent.stdout.once("data", resolve));
  const grandchild = Number(fs.readFileSync(pidFile, "utf8"));
  assert.ok(alive(grandchild));
  stopProcess(parent);
  await exited(parent);
  for (let i = 0; i < 50 && alive(grandchild); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(alive(grandchild), false);
});
