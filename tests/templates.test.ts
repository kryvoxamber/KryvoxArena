import test from "node:test";
import assert from "node:assert/strict";
import { renderEmail } from "../supabase/functions/_shared/templates.ts";
test("templates escape HTML in every dynamic field", () => {
  const html = renderEmail("CUSTOM", { title: "<script>x</script>", message: '<img src=x onerror=alert(1)>' });
  assert.ok(!html.includes("<script>")); assert.ok(!html.includes("<img"));
  const r = renderEmail("ROOM_DETAILS", { tournament: "T", match: "M", room_id: "<b>1</b>", room_password: '"><x>' });
  assert.ok(!r.includes("<b>1</b>")); assert.ok(r.includes("&lt;b&gt;"));
});
