// PUBLIC browser configuration. The Supabase anon key is designed to be public (access is enforced by RLS).
// Never put service-role keys, payment secrets or Resend keys here. Fill these in after creating the Supabase project.
export const CONFIG = {
  SUPABASE_URL: "",       // e.g. https://abcdxyz.supabase.co
  SUPABASE_ANON_KEY: "",  // anon / publishable key
  SITE_NAME: "Kryvox Arena"
};
export const configured = () => Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
