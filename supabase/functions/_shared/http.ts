export const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin"
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
export class HttpError extends Error { constructor(public status: number, public code: string) { super(code); } }
// Wrap a handler: CORS preflight, POST only, errors -> {error: CODE} without leaking internals.
export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    try { return await fn(req); }
    catch (e) {
      if (e instanceof HttpError) return json({ error: e.code }, e.status);
      console.error("unhandled", e instanceof Error ? e.message : e);
      return json({ error: "INTERNAL" }, 500);
    }
  };
}
