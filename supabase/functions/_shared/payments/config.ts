// Reads provider credentials from Edge Function secrets (never from the DB or the browser).
import { env } from "../clients.ts";
import type { RzCfg } from "./razorpay.ts";
import type { PpCfg } from "./phonepe.ts";
export const razorpayCfg = (): RzCfg => ({ keyId: env("RAZORPAY_KEY_ID"), keySecret: env("RAZORPAY_KEY_SECRET"), webhookSecret: env("RAZORPAY_WEBHOOK_SECRET", false) });
export const phonepeCfg = (environment: "SANDBOX" | "PRODUCTION"): PpCfg => ({
  clientId: env("PHONEPE_CLIENT_ID"), clientSecret: env("PHONEPE_CLIENT_SECRET"), clientVersion: env("PHONEPE_CLIENT_VERSION"), env: environment,
  redirectUrl: `${env("SITE_URL")}/dashboard`, webhookUser: env("PHONEPE_WEBHOOK_USERNAME", false), webhookPass: env("PHONEPE_WEBHOOK_PASSWORD", false)
});
