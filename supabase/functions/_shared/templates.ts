import { esc, layout } from "./html.ts";
// Pure renderers: (template, payload) -> html. Every dynamic value is HTML-escaped.
export function renderEmail(template: string, p: Record<string, unknown>): string {
  const line = (k: string, v: unknown) => `<p><b>${esc(k)}:</b> ${esc(v)}</p>`;
  switch (template) {
    case "REGISTRATION_CONFIRMATION":
      return layout("Registration confirmed", `<p>Tumhara slot confirm ho gaya hai.</p>${line("Tournament", p.tournament)}${line("Mode", p.mode)}${line("Team", p.team)}${line("Booking code", p.booking_code)}${line("Starts", p.starts_at)}`);
    case "ROOM_DETAILS":
    case "ROOM_DETAILS_UPDATE":
      return layout(template === "ROOM_DETAILS" ? "Room details" : "Room details updated", `${line("Tournament", p.tournament)}${line("Match", p.match)}${line("Room ID", p.room_id)}${line("Password", p.room_password)}<p>Ye details kisi ke saath share mat karo.</p>`);
    case "MATCH_REMINDER": case "MATCH_STARTING":
      return layout(template === "MATCH_REMINDER" ? "Match reminder" : "Match starting", `${line("Tournament", p.tournament)}${line("Starts", p.starts_at)}`);
    case "TOURNAMENT_POSTPONED": case "TOURNAMENT_CANCELLED":
      return layout(template === "TOURNAMENT_POSTPONED" ? "Tournament postponed" : "Tournament cancelled", `${line("Tournament", p.tournament)}<p>${esc(p.message)}</p>`);
    case "WINNER_ANNOUNCEMENT":
      return layout("Winners", `${line("Tournament", p.tournament)}<p>${esc(p.message)}</p>`);
    default:
      return layout(String(p.title ?? "Update"), `<p style="white-space:pre-wrap">${esc(p.message)}</p>`);
  }
}
