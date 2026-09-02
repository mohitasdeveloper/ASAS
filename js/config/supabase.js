/**
 * ASAS — Supabase Client Configuration
 * ─────────────────────────────────────
 * Replace SUPABASE_URL and SUPABASE_ANON_KEY with your
 * project values from: https://app.supabase.com → Project Settings → API
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// ──────────────────────────────────────────────
// REPLACE THESE WITH YOUR ACTUAL PROJECT VALUES
// ──────────────────────────────────────────────
const SUPABASE_URL  = 'https://cljjedekjkeabrvumsar.supabase.co';   // ← replace
const SUPABASE_ANON_KEY = 'sb_publishable_toBASQRZw3t4Dc-N7_AP8w_FAeBqErQ';              // ← replace
// ──────────────────────────────────────────────

if (SUPABASE_URL === 'https://YOUR_PROJECT_ID.supabase.co') {
  console.warn(
    '[ASAS] Supabase is not configured yet.\n' +
    'Open js/config/supabase.js and set SUPABASE_URL and SUPABASE_ANON_KEY.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Persist session in localStorage so page refreshes keep the user logged in
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,   // needed for password-reset redirect links
  },
});
