import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { effectiveTlsMode, sslOption } from "../src/drivers/postgres.js";

test("with no TLS setting, keep the old localhost/folder rule", () => {
  const mode = (host, folder = null) => effectiveTlsMode({ host, folder, tls: { mode: null } });
  assert.equal(mode("localhost"), "disable");
  assert.equal(mode("127.0.0.1"), "disable");
  assert.equal(mode("db.example.com", "local"), "disable");
  assert.equal(mode("db.example.com", "no_ssl"), "disable");
  assert.equal(mode("db.example.com"), "require");
});

test("the profile's TLS mode wins over the fallback rule", () => {
  assert.equal(effectiveTlsMode({ host: "localhost", tls: { mode: "verify-full" } }), "verify-full");
  assert.equal(effectiveTlsMode({ host: "db.example.com", tls: { mode: "disable" } }), "disable");
});

test("ssl option for each mode", () => {
  assert.equal(sslOption("disable"), false);
  assert.deepEqual(sslOption("prefer"), { rejectUnauthorized: false });
  assert.deepEqual(sslOption("require"), { rejectUnauthorized: false });
  assert.deepEqual(sslOption("verify-full", { servername: "db.example.com" }), {
    rejectUnauthorized: true,
    servername: "db.example.com",
  });
  const verifyCa = sslOption("verify-ca");
  assert.equal(verifyCa.rejectUnauthorized, true);
  assert.equal(verifyCa.checkServerIdentity(), undefined);
});

test("the root certificate is read from its file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-dbs-"));
  const ca = path.join(dir, "ca.pem");
  fs.writeFileSync(ca, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n");
  try {
    assert.match(sslOption("verify-full", { rootCert: ca }).ca, /BEGIN CERTIFICATE/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
