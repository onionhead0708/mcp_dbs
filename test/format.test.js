import { test } from "node:test";
import assert from "node:assert/strict";
import { toJsonSafe, formatRows } from "../src/format.js";

class Decimal {
  constructor(text) { this.text = text; }
  toString() { return this.text; }
}

test("converts values JSON cannot hold", () => {
  assert.equal(toJsonSafe(12345678901234567890n), "12345678901234567890");
  assert.equal(toJsonSafe(new Date("2026-01-02T03:04:05Z")), "2026-01-02T03:04:05.000Z");
  assert.equal(toJsonSafe(new Date("nope")), null);
  assert.equal(toJsonSafe(Buffer.from([0xde, 0xad])), "\\xdead");
  assert.equal(toJsonSafe(new Uint8Array([1, 2])), "\\x0102");
  assert.equal(toJsonSafe(NaN), "NaN");
  assert.equal(toJsonSafe(Infinity), "Infinity");
  assert.equal(toJsonSafe(undefined), null);
  assert.equal(toJsonSafe(new Decimal("1.10")), "1.10");
});

test("recurses into arrays, objects, maps and sets", () => {
  const value = { a: [1n, { b: new Map([["k", 2n]]) }], s: new Set([3n]) };
  assert.deepEqual(toJsonSafe(value), { a: ["1", { b: { k: "2" } }], s: ["3"] });
});

test("survives cycles but repeats shared values", () => {
  const shared = { x: 1 };
  const cyclic = { shared, again: shared };
  cyclic.self = cyclic;
  assert.deepEqual(toJsonSafe(cyclic), { shared: { x: 1 }, again: { x: 1 }, self: "[circular]" });
});

test("formatRows cuts to max_rows and says so", () => {
  const rows = [{ n: 1 }, { n: 2 }, { n: 3 }];
  const cut = formatRows(rows, 2);
  assert.deepEqual(JSON.parse(cut.text), [{ n: 1 }, { n: 2 }]);
  assert.deepEqual([cut.truncated, cut.shown, cut.total], [true, 2, 3]);
  assert.equal(formatRows(rows).truncated, false);
  assert.equal(formatRows(rows, 3).truncated, false);
});
