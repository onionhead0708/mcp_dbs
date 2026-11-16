#!/usr/bin/env node
// Regenerates test/fixtures/dbeaver/credentials-config.json, encrypted the way
// DBeaver encrypts it: AES-128-CBC with DBeaver's fixed key, where the first
// 16 bytes of the file are the IV. Every credential here is fake.
//
//   node scripts/make-dbeaver-credentials.js
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const KEY = Buffer.from("babb4a9f774ab853c96c2d653dfe544a", "hex");
// A fixed IV keeps the output reproducible.
const IV = Buffer.from("00112233445566778899aabbccddeeff", "hex");

const credentials = {
  "postgres-jdbc-local-1": { "#connection": { user: "tester", password: "test-password" } },
  "postgres-jdbc-prod-1": { "#connection": { user: "reporter", password: "test-password-2" } },
  "microsoft-local-1": { "#connection": { user: "tester", password: "test-password-3" } }
};

const cipher = crypto.createCipheriv("aes-128-cbc", KEY, IV);
const encrypted = Buffer.concat([IV, cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "dbeaver", "credentials-config.json");
fs.writeFileSync(out, encrypted);
console.log(`wrote ${out}`);
