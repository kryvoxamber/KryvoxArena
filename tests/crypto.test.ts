import test from "node:test";
import assert from "node:assert/strict";
import { hmacHex, safeEqual, sha256Hex } from "../supabase/functions/_shared/crypto.ts";

test("hmac known vector (RFC 4231 case 2)", async () => {
  assert.equal(await hmacHex("Jefe", "what do ya want for nothing?"), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
});
test("sha256 known vector", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
test("safeEqual", () => { assert.ok(safeEqual("a", "a")); assert.ok(!safeEqual("a", "b")); assert.ok(!safeEqual("a", "ab")); });
