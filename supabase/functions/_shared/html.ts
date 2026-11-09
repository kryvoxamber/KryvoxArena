// Pure HTML helpers (no Deno/network imports) so they can be unit-tested in Node.
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function layout(title: string, bodyHtml: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;background:#0b1020;color:#e8ecf8;padding:24px;border-radius:10px">
<h2 style="margin:0 0 12px;color:#7fb2ff">KRYVOX ARENA</h2><h3 style="margin:0 0 14px">${esc(title)}</h3>${bodyHtml}
<p style="color:#8d97b5;font-size:12px;margin-top:24px">Is email ka jawab dene ki zaroorat nahi. Agar ye aapne request nahi kiya, ignore karo.</p></div>`;
}

