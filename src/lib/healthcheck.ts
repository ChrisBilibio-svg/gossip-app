import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseConfigured } from './supabase';

export type HealthStatus = 'pending' | 'ok' | 'error' | 'unconfigured';

export interface HealthResult {
  status: HealthStatus;
  detail: string;
}

/**
 * Confirms the app can reach Supabase with the configured URL + key.
 * Hits the GoTrue settings endpoint (`/auth/v1/settings`) with the apikey header:
 *   - 200  → URL reachable AND key valid
 *   - 401  → key missing/invalid
 *   - throw → URL/network unreachable
 */
export async function checkSupabaseHealth(): Promise<HealthResult> {
  if (!supabaseConfigured) {
    return {
      status: 'unconfigured',
      detail: 'Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env',
    };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_ANON_KEY,
      },
    });
    if (res.ok) {
      return { status: 'ok', detail: 'Conectado ao Supabase' };
    }
    if (res.status === 401) {
      return { status: 'error', detail: 'Chave inválida (401) — confira a anon/publishable key' };
    }
    return { status: 'error', detail: `Supabase respondeu ${res.status}` };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return { status: 'error', detail: msg };
  }
}
