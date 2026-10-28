import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && key);

export const supabase = configured
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

export const BUCKET = 'animal-photos';

/** Public URL of a stored photo, or '' when there is none. */
export function photoUrl(path) {
  if (!path || !supabase) return '';
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Base address printed into collar QR codes. Set VITE_PUBLIC_URL once you have a domain. */
export const siteUrl = (import.meta.env.VITE_PUBLIC_URL || window.location.origin).replace(/\/+$/, '');

export const projectContact = import.meta.env.VITE_CONTACT || '';
export const googleSignIn = import.meta.env.VITE_GOOGLE_SIGNIN === 'true';
