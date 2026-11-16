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
// A fixed IV keeps the output reproducible. index.js decrypts the whole file
// with a zero IV and keeps everything from the first "{", so the garbled first
// block must not contain "{" (checked below).
const IV = Buffer.from("00112233445566778899aabbccddeeff", "hex");

const credentials = {
  "postgres-jdbc-local-1": { "#connection": { user: "tester", password: "test-password" } },
  "postgres-jdbc-prod-1": { "#connection": { user: "reporter", password: "test-password-2" } },
  "microsoft-local-1": { "#connection": { user: "tester", password: "test-password-3" } }
};

const cipher = crypto.createCipheriv("aes-128-cbc", KEY, IV);
const encrypted = Buffer.concat([IV, cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);

const zeroIv = crypto.createDecipheriv("aes-128-cbc", KEY, Buffer.alloc(16, 0));
const garbled = Buffer.concat([zeroIv.update(encrypted), zeroIv.final()]).subarray(0, 16);
if (garbled.includes(0x7b)) throw new Error("First block contains '{'; pick another IV");

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "dbeaver", "credentials-config.json");
fs.writeFileSync(out, encrypted);
console.log(`wrote ${out}`);
