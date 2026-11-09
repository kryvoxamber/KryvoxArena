// Pure WebCrypto helpers (work in Deno and Node 20+, so they are unit-tested with Node).
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function hmacHex(secret: string, data: string, hash: "SHA-256" | "SHA-512" = "SHA-256"): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
export async function sha256Hex(data: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(data)));
}
// Constant-time string comparison (length leak only).
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  if (x.length !== y.length) return false;
  let r = 0;
  for (let i = 0; i < x.length; i++) r |= x[i] ^ y[i];
  return r === 0;
}
export function randomDigits(n: number): string {
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  return [...buf].map((v) => String(v % 10)).join("");
}
export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const p = jwt.split(".")[1] ?? "";
  const json = atob(p.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(p.length / 4) * 4, "="));
  return JSON.parse(json);
}
