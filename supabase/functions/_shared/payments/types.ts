// Provider-independent payment contract. Business logic (finalize_payment_success in SQL) never sees provider specifics.
export type VerifiedStatus = "SUCCESS" | "FAILED" | "PENDING";
export interface OrderRef { id: string; internal_order_reference: string; provider_order_id: string | null; amount: number; currency: string; }
export interface StatusResult { status: VerifiedStatus; providerTxnId: string | null; amount: number | null; currency: string | null; rawStatus: string; }
export interface CreateResult { providerOrderId: string; redirectUrl?: string; checkout?: Record<string, unknown>; }
export type Fetch = typeof fetch;
export const toPaise = (rupees: number) => Math.round(rupees * 100);
export const fromPaise = (p: number) => Math.round(p) / 100;
