import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// ─── Cold-launch network resilience ────────────────────────────────────────
// Measured on-device: the FIRST request after a cold app launch can stall for
// 45-70s (iOS radio waking / weak signal), while the server itself answers in
// ~200ms and every WARM request is <1s. supabase-js sets no timeout, so a
// stalled connection hangs until the OS gives up (~70s). We wrap fetch to:
//   1. time out every request, so nothing hangs indefinitely, and
//   2. retry ONCE — but ONLY for reads, so a lost-response insert/mutation can
//      never be applied twice.
//
// "Read" = GET/HEAD, or a POST to /rest/v1/rpc/get_* (supabase-js issues RPCs
// as POST; our get_* RPCs are all read-only/STABLE, so a retry is side-effect
// -free). Table inserts (POST /rest/v1/<table>), PATCH, DELETE and any
// non-get_* RPC are timed out but NEVER retried.
const FIRST_TIMEOUT_MS = 15000;
const RETRY_TIMEOUT_MS = 12000;

function isRetryableRead(url, method) {
  const m = (method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD') return true;
  if (m === 'POST' && /\/rest\/v1\/rpc\/get_/.test(String(url))) return true;
  return false;
}

async function fetchWithTimeout(input, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const resilientFetch = async (input, init = {}) => {
  // Requests that already carry an abort signal (e.g. GoTrue's own auth calls)
  // manage their own lifecycle — pass them straight through untouched.
  if (init && init.signal) return fetch(input, init);

  const url = typeof input === 'string' ? input : (input && input.url) || '';
  const method = (init && init.method) || (typeof input === 'object' && input && input.method) || 'GET';

  // ONLY guard reads. Writes/inserts (mutation-sensitive), storage uploads
  // (WAV/audio chunks) and edge functions (AI, transcription) are either unsafe
  // to retry or legitimately long — a timeout would abort them, so leave them
  // exactly as supabase-js issues them.
  if (!isRetryableRead(url, method)) return fetch(input, init);

  try {
    return await fetchWithTimeout(input, init, FIRST_TIMEOUT_MS);
  } catch (err) {
    // One retry — by now the radio is usually awake, so this lands fast.
    return await fetchWithTimeout(input, init, RETRY_TIMEOUT_MS);
  }
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: resilientFetch,
  },
});
