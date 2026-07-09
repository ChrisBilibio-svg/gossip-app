import { supabase, supabaseConfigured } from './supabase';

export interface KeywordSubscription {
  id: string;
  keyword: string;
  createdAt: string;
}

export interface KeywordMutationResult {
  ok: boolean;
  keyword?: string;
  error?: string;
}

export function normalizeKeyword(keyword: string): string {
  return String(keyword ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateKeyword(keyword: string): KeywordMutationResult {
  const normalized = normalizeKeyword(keyword);
  if (normalized.length < 2) return { ok: false, error: 'Digite pelo menos 2 caracteres.' };
  if (normalized.length > 48) return { ok: false, error: 'Tópico muito longo.' };
  return { ok: true, keyword: normalized };
}

function mapKeywordRow(row: { id: string; keyword: string; created_at: string }): KeywordSubscription {
  return {
    id: row.id,
    keyword: row.keyword,
    createdAt: row.created_at,
  };
}

export async function subscribeKeyword(keyword: string): Promise<KeywordMutationResult> {
  if (!supabaseConfigured) return { ok: false, error: 'Supabase não configurado.' };
  const validation = validateKeyword(keyword);
  if (!validation.ok || !validation.keyword) return validation;

  const { error } = await supabase
    .from('keyword_subscriptions')
    .upsert(
      { keyword: validation.keyword },
      { onConflict: 'user_id,keyword', ignoreDuplicates: true },
    );

  if (error) return { ok: false, keyword: validation.keyword, error: error.message };
  return { ok: true, keyword: validation.keyword };
}

export async function unsubscribeKeyword(keyword: string): Promise<KeywordMutationResult> {
  if (!supabaseConfigured) return { ok: false, error: 'Supabase não configurado.' };
  const validation = validateKeyword(keyword);
  if (!validation.ok || !validation.keyword) return validation;

  const { error } = await supabase
    .from('keyword_subscriptions')
    .delete()
    .eq('keyword', validation.keyword);

  if (error) return { ok: false, keyword: validation.keyword, error: error.message };
  return { ok: true, keyword: validation.keyword };
}

export async function listKeywords(): Promise<{ keywords: KeywordSubscription[]; error: string | null }> {
  if (!supabaseConfigured) return { keywords: [], error: 'Supabase não configurado.' };

  const { data, error } = await supabase
    .from('keyword_subscriptions')
    .select('id, keyword, created_at')
    .order('created_at', { ascending: false });

  if (error) return { keywords: [], error: error.message };
  return { keywords: (data ?? []).map((row) => mapKeywordRow(row)), error: null };
}
