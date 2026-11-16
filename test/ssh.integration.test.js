// SSH tunnels against a real sshd and a Postgres only it can reach (T6.8).
// Skipped unless SSH_TEST_DIR is set; see scripts/ssh-test-env.sh. The tests
// use their own ssh config (MCP_DBS_SSH_CONFIG), never ~/.ssh or the agent.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Session } from "../src/session.js";
import { createHandlers } from "../src/server.js";
import { Registry } from "../src/profiles/registry.js";
import { makeProfile } from "../src/profiles/model.js";
import { inlineSecret } from "../src/secrets/index.js";
import { runningCount } from "../src/tunnels/process.js";

const env = process.env;
const skip = env.SSH_TEST_DIR ? false : "set SSH_TEST_DIR (scripts/ssh-test-env.sh) to run against sshd";
const dir = env.SSH_TEST_DIR;

let handlers;
let session;
const text = (result) => result.content.map((c) => c.text).join("\n");

function sshConfig(name, knownHosts) {
  const file = path.join(dir, `${name}.config`);
  fs.writeFileSync(
    file,
    [
      "Host tunnel-test",
      "  HostName 127.0.0.1",
      `  Port ${env.SSH_TEST_PORT}`,
      "  User tester",
      `  UserKnownHostsFile "${knownHosts}"`,
      "  StrictHostKeyChecking yes",
      "  IdentityAgent none",
      "  IdentitiesOnly yes",
      "",
    ].join("\n")
  );
  return file;
}

before(() => {
  if (skip) return;
  const viaSsh = (localId, tunnel) =>
    makeProfile({
      source: "dbdelve",
      localId,
      engine: "postgres",
      host: env.SSH_TEST_DB_HOST,
      port: 5432,
      database: "postgres",
      auth: { type: "password", user: "postgres", secretRef: inlineSecret(env.SSH_TEST_DB_PASSWORD) },
      tls: { mode: "disable" },
      tunnel: { type: "ssh", host: "tunnel-test", port: null, user: null, identityFile: null, secretRef: null, ...tunnel },
    });
  const registry = new Registry([
    {
      name: "dbdelve",
      load: () => ({
        profiles: [
          viaSsh("encrypted-key", { identityFile: path.join(dir, "id_encrypted"), secretRef: inlineSecret(env.SSH_TEST_PASSPHRASE) }),
          viaSsh("plain-key", { identityFile: path.join(dir, "id_plain") }),
          viaSsh("wrong-passphrase", { identityFile: path.join(dir, "id_encrypted"), secretRef: inlineSecret("not it") }),
          viaSsh("encrypted-no-passphrase", { identityFile: path.join(dir, "id_encrypted") }),
        ],
        skipped: [],
      }),
    },
  ]);
  session = new Session();
  handlers = createHandlers({ registry, session });
  env.MCP_DBS_SSH_CONFIG = sshConfig("trusted", path.join(dir, "known_hosts"));
});

after(async () => {
  await session?.disconnect();
  delete env.MCP_DBS_SSH_CONFIG;
});

async function connected(id) {
  const result = await handlers.connect({ profile_id: id });
  assert.ok(!result.isError, text(result));
}

test("an encrypted key: the passphrase goes through askpass, and the database answers", { skip }, async () => {
  const before = runningCount();
  await connected("encrypted-key");
  assert.equal(runningCount(), before + 1, "one ssh running");
  const [row] = JSON.parse(text(await handlers.query({ sql: "SELECT current_user AS u, 1 + 1 AS two" })));
  assert.deepEqual(row, { u: "postgres", two: 2 });

  const status = JSON.parse(text(await handlers.status()));
  assert.match(status.tunnel, /^ssh tunnel-test -> /);
  assert.match(status.endpoint, /^127\.0\.0\.1:\d+$/);

  await handlers.disconnect();
  assert.equal(runningCount(), before, "disconnect stops ssh");
});

test("a key without a passphrase uses BatchMode and works", { skip }, async () => {
  await connected("plain-key");
  assert.deepEqual(JSON.parse(text(await handlers.query({ sql: "SELECT 1 AS one" }))), [{ one: 1 }]);
  await handlers.disconnect();
});

test("connecting to another profile stops the old tunnel", { skip }, async () => {
  const before = runningCount();
  await connected("plain-key");
  await connected("encrypted-key");
  assert.equal(runningCount(), before + 1);
  await handlers.disconnect();
  assert.equal(runningCount(), before);
});

test("a wrong passphrase is explained and leaves nothing running", { skip }, async () => {
  const before = runningCount();
  const result = await handlers.connect({ profile_id: "wrong-passphrase" });
  assert.equal(result.isError, true);
  assert.match(text(result), /passphrase did not unlock it/);
  assert.ok(!text(result).includes("not it"), "the passphrase is never echoed");
  assert.equal(runningCount(), before);
});

test("an encrypted key with no saved passphrase fails fast instead of waiting for a prompt", { skip }, async () => {
  const started = Date.now();
  const result = await handlers.connect({ profile_id: "encrypted-no-passphrase" });
  assert.equal(result.isError, true);
  assert.ok(Date.now() - started < 15_000, "BatchMode: no hanging prompt");
  assert.match(text(result), /needs a passphrase, and none is saved/);
});

test("an unknown host key is never accepted, and the error says how to fix it (T6.4)", { skip }, async () => {
  const empty = path.join(dir, "empty_known_hosts");
  fs.writeFileSync(empty, "");
  const trusted = env.MCP_DBS_SSH_CONFIG;
  env.MCP_DBS_SSH_CONFIG = sshConfig("untrusted", empty);
  try {
    const result = await handlers.connect({ profile_id: "plain-key" });
    assert.equal(result.isError, true);
    assert.match(text(result), /host key for tunnel-test is not known.*Run `ssh tunnel-test` once/);
    assert.equal(fs.readFileSync(empty, "utf8"), "", "nothing was added to known_hosts");
  } finally {
    env.MCP_DBS_SSH_CONFIG = trusted;
  }
});
