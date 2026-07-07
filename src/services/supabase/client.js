import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// NB: we deliberately do NOT wrap fetch with an aggressive timeout+retry.
// On this device the FIRST connection after a cold launch can take 40-70s to
// establish (radio wake / weak signal); a short timeout aborts it before it
// lands and turns a slow-but-successful initial load into a FAILED one (blank
// app). A slow load is better than no load. Perceived latency is handled where
// it matters instead — the roster and the Start-Class briefing paint instantly
// from persisted AsyncStorage caches (stale-while-revalidate), so the cold
// connection cost happens off the user's critical path.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
