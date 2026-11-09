import test from "node:test";
import assert from "node:assert/strict";
import { hmacHex, safeEqual, randomDigits, sha256Hex } from "../supabase/functions/_shared/crypto.ts";
import { otpHash, otpMatches, recentOtpLogin } from "../supabase/functions/_shared/otp.ts";

test("hmac known vector (RFC 4231 case 2)", async () => {
  assert.equal(await hmacHex("Jefe", "what do ya want for nothing?"), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
});
test("sha256 known vector", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
test("otp accepts correct code only, bound to user", async () => {
  const h = await otpHash("pepper", "u1", "123456");
  assert.ok(await otpMatches("pepper", "u1", "123456", h));
  assert.ok(!(await otpMatches("pepper", "u1", "123457", h)));
  assert.ok(!(await otpMatches("pepper", "u2", "123456", h)));
  assert.ok(!(await otpMatches("other", "u1", "123456", h)));
  assert.ok(!(await otpMatches("pepper", "u1", "12345", h)));
  assert.ok(!(await otpMatches("pepper", "u1", "abcdef", h)));
});
test("safeEqual", () => { assert.ok(safeEqual("a", "a")); assert.ok(!safeEqual("a", "b")); assert.ok(!safeEqual("a", "ab")); });
test("randomDigits is n digits", () => { for (let i = 0; i < 50; i++) assert.match(randomDigits(6), /^[0-9]{6}$/); });
test("recentOtpLogin requires fresh otp method (google does not qualify)", () => {
  const now = 1_000_000;
  assert.ok(recentOtpLogin({ amr: [{ method: "otp", timestamp: now - 30 }] }, now));
  assert.ok(!recentOtpLogin({ amr: [{ method: "otp", timestamp: now - 3600 }] }, now));
  assert.ok(!recentOtpLogin({ amr: [{ method: "oauth", timestamp: now - 5 }] }, now));
  assert.ok(!recentOtpLogin({}, now));
});
