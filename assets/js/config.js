// PUBLIC browser configuration. The Supabase anon key is designed to be public (access is enforced by RLS).
// Never put service-role keys, payment secrets or Resend keys here. Fill these in after creating the Supabase project.
export const CONFIG = {
  SUPABASE_URL: "https://vsnxahrjqoysqqzelsmp.supabase.co",       // e.g. https://abcdxyz.supabase.co
  SUPABASE_ANON_KEY: "sb_publishable_0MluQK3rIPGv6SFZ42ZBLw_hiDzQM-S",  // anon / publishable key
  SITE_NAME: "Kryvox Arena"
};
export const configured = () => Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
