import { isMissingRpcError } from './rpcFallback';
import { supabase, supabaseConfigured } from './supabase';
import { mapRumorRows, type FeedResult, type Rumor, type RumorRow } from './rumors';
import { filterRumorsByQuery } from './feedSearchCore';

export { filterRumorsByQuery } from './feedSearchCore';

function localSearchResult(fallbackRumors: Rumor[], query: string): FeedResult {
  return { rumors: filterRumorsByQuery(fallbackRumors, query), error: null };
}

/**
 * Server-side catalog search for published rumors. Falls back to local filtering
 * while the search_rumors migration is still unapplied or Supabase is disabled.
 */
export async function searchRumorsByQuery(query: string, fallbackRumors: Rumor[] = [], limit = 50): Promise<FeedResult> {
  if (!query.trim()) return localSearchResult(fallbackRumors, query);
  if (!supabaseConfigured) return localSearchResult(fallbackRumors, query);

  const { data, error } = await supabase.rpc('search_rumors', { p_query: query.trim(), p_limit: limit });

  if (error) {
    if (isMissingRpcError(error)) return localSearchResult(fallbackRumors, query);
    const fallbackError = error as { message?: string };
    return { rumors: [], error: String(fallbackError.message ?? 'Search unavailable') };
  }

  return { rumors: mapRumorRows((data ?? []) as RumorRow[]), error: null };
}
