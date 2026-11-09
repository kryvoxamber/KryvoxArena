import test from "node:test";
import assert from "node:assert/strict";
import { hmacHex } from "../supabase/functions/_shared/crypto.ts";
import * as rz from "../supabase/functions/_shared/payments/razorpay.ts";
import * as pp from "../supabase/functions/_shared/payments/phonepe.ts";
import { sha256Hex } from "../supabase/functions/_shared/crypto.ts";
import { toPaise, fromPaise } from "../supabase/functions/_shared/payments/types.ts";

const cfg = { keyId: "rzp_test_x", keySecret: "sec" };
const order = { id: "o1", internal_order_reference: "KRXP1", provider_order_id: "order_abc", amount: 100.5, currency: "INR" };

test("paise conversion is exact", () => { assert.equal(toPaise(100.5), 10050); assert.equal(toPaise(0.29), 29); assert.equal(fromPaise(10050), 100.5); });

test("razorpay checkout signature: valid, tampered, wrong order", async () => {
  const sig = await hmacHex("sec", "order_abc|pay_1");
  assert.ok(await rz.verifyCheckoutSignature(cfg, "order_abc", "pay_1", sig));
  assert.ok(!(await rz.verifyCheckoutSignature(cfg, "order_abc", "pay_2", sig)));
  assert.ok(!(await rz.verifyCheckoutSignature(cfg, "order_x", "pay_1", sig)));
  assert.ok(!(await rz.verifyCheckoutSignature(cfg, "order_abc", "pay_1", "")));
});
test("razorpay webhook signature over raw body", async () => {
  const body = '{"event":"payment.captured"}';
  const sig = await hmacHex("whsec", body);
  assert.ok(await rz.verifyWebhookSignature("whsec", body, sig));
  assert.ok(!(await rz.verifyWebhookSignature("whsec", body + " ", sig)));
  assert.ok(!(await rz.verifyWebhookSignature("whsec", body, null)));
  assert.ok(!(await rz.verifyWebhookSignature("", body, sig)));
});
test("razorpay status mapping: only captured is success", () => {
  assert.equal(rz.mapRazorpayPayments([{ id: "p", status: "captured", amount: 10050, currency: "INR" }]).status, "SUCCESS");
  assert.equal(rz.mapRazorpayPayments([{ id: "p", status: "authorized", amount: 10050, currency: "INR" }]).status, "PENDING");
  assert.equal(rz.mapRazorpayPayments([{ id: "p", status: "failed", amount: 10050, currency: "INR" }]).status, "FAILED");
  assert.equal(rz.mapRazorpayPayments([{ id: "p", status: "failed", amount: 1, currency: "INR" }, { id: "q", status: "captured", amount: 10050, currency: "INR" }]).providerTxnId, "q");
  assert.equal(rz.mapRazorpayPayments([]).status, "PENDING");
});
test("razorpay fetchStatus uses server API and basic auth (mock fetch)", async () => {
  let seen: any;
  const f = (async (url: string, init: any) => { seen = { url, init }; return new Response(JSON.stringify({ items: [{ id: "pay_9", status: "captured", amount: 10050, currency: "INR" }] }), { status: 200 }); }) as any;
  const r = await rz.fetchStatus(cfg, order, f);
  assert.equal(r.status, "SUCCESS"); assert.equal(r.amount, 100.5);
  assert.match(seen.url, /orders\/order_abc\/payments$/); assert.match(seen.init.headers.Authorization, /^Basic /);
});
test("razorpay createOrder sends paise + receipt, fails closed", async () => {
  let body: any;
  const ok = (async (_u: string, init: any) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ id: "order_n", amount: 10050 }), { status: 200 }); }) as any;
  const r = await rz.createOrder(cfg, order, ok);
  assert.equal(body.amount, 10050); assert.equal(body.receipt, "KRXP1"); assert.equal(r.providerOrderId, "order_n");
  const bad = (async () => new Response("{}", { status: 400 })) as any;
  await assert.rejects(() => rz.createOrder(cfg, order, bad), /RAZORPAY_CREATE_FAILED/);
});
test("phonepe state mapping", () => {
  const ok = pp.mapPhonePeState({ state: "COMPLETED", amount: 10050, paymentDetails: [{ transactionId: "T1", state: "COMPLETED" }] });
  assert.equal(ok.status, "SUCCESS"); assert.equal(ok.amount, 100.5); assert.equal(ok.providerTxnId, "T1");
  assert.equal(pp.mapPhonePeState({ state: "PENDING" }).status, "PENDING");
  assert.equal(pp.mapPhonePeState({ state: "FAILED" }).status, "FAILED");
  assert.equal(pp.mapPhonePeState({}).status, "PENDING");
  assert.equal(pp.mapPhonePeState({ state: "SOMETHING_NEW" }).status, "PENDING");
});
test("phonepe webhook auth = sha256(user:pass)", async () => {
  const h = await sha256Hex("u:p");
  assert.ok(await pp.verifyWebhookAuth("u", "p", h));
  assert.ok(await pp.verifyWebhookAuth("u", "p", h.toUpperCase()));
  assert.ok(!(await pp.verifyWebhookAuth("u", "x", h)));
  assert.ok(!(await pp.verifyWebhookAuth("u", "p", null)));
  assert.ok(!(await pp.verifyWebhookAuth(undefined, undefined, h)));
});
test("phonepe createOrder uses O-Bearer token and paise (mock fetch)", async () => {
  const calls: any[] = [];
  const f = (async (url: string, init: any) => { calls.push({ url, init });
    if (String(url).includes("oauth")) return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
    return new Response(JSON.stringify({ orderId: "OMO1", redirectUrl: "https://pay.example/x" }), { status: 200 }); }) as any;
  const r = await pp.createOrder({ clientId: "c", clientSecret: "s", clientVersion: "1", env: "SANDBOX", redirectUrl: "https://site/dashboard" }, order, 900, f);
  assert.equal(r.redirectUrl, "https://pay.example/x");
  assert.equal(calls[1].init.headers.Authorization, "O-Bearer tok");
  const b = JSON.parse(calls[1].init.body); assert.equal(b.amount, 10050); assert.equal(b.merchantOrderId, "KRXP1");
  assert.match(calls[0].url, /pg-sandbox/);
});
