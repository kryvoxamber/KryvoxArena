import { handler, json, HttpError } from "../_shared/http.ts";
import { admin, requireUser } from "../_shared/clients.ts";

Deno.serve(handler(async (req) => {
  const { user } = await requireUser(req);
  const b = await req.json().catch(() => ({}));
  const utr = String(b.utr ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{8,30}$/.test(utr)) throw new HttpError(400, "INVALID_UTR");
  const path = b.proof_path ? String(b.proof_path) : null;
  if (path && !path.startsWith(user.id + "/")) throw new HttpError(400, "INVALID_PROOF_PATH");   // proofs live in the caller's own folder only
  const { data, error } = await admin().rpc("submit_manual_upi", { p_user: user.id, p_order: b.order_id, p_utr: utr,
    p_payer: b.payer_name ? String(b.payer_name).slice(0, 80) : null, p_amount: null, p_paid_at: b.paid_at ?? null, p_proof_path: path });
  if (error) throw new HttpError(400, (error.message.match(/[A-Z_]{6,}/) ?? ["SUBMIT_FAILED"])[0]);
  return json({ ok: true, submission_id: data });
}));
