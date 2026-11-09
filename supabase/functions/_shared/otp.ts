import { hmacHex, safeEqual } from "./crypto.ts";
export const OTP_TTL_MIN = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_SENDS_PER_10_MIN = 3;
export const otpHash = (pepper: string, userId: string, code: string) => hmacHex(pepper, `${userId}:${code}`);
export async function otpMatches(pepper: string, userId: string, code: string, storedHash: string): Promise<boolean> {
  if (!/^[0-9]{6}$/.test(code)) return false;
  return safeEqual(await otpHash(pepper, userId, code), storedHash);
}

export function recentOtpLogin(payload: Record<string, unknown>, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const amr = Array.isArray(payload.amr) ? (payload.amr as Array<{ method?: string; timestamp?: number }>) : [];
  return amr.some((a) => a.method === "otp" && typeof a.timestamp === "number" && nowSec - a.timestamp < 600);
}
