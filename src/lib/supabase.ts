import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client. Reads keys from Expo public env vars (.env):
 *   EXPO_PUBLIC_SUPABASE_URL
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY
 * The anon key is safe to ship in the client — access is governed by RLS.
 */

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Supabase throws during module import if URL/key are empty. Keep the app
// renderable in fresh clones so the UI can show a setup message instead of a
// blank screen.
const clientUrl = supabaseConfigured ? SUPABASE_URL : 'https://example.supabase.co';
const clientKey = supabaseConfigured ? SUPABASE_ANON_KEY : 'placeholder-anon-key';

export const supabase = createClient(clientUrl, clientKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // not a web redirect flow
  },
});
