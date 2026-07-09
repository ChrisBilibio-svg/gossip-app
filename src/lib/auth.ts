import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from './supabase';
import { validateEmailInput, validatePasswordInput } from './inputValidation';

export const AUTH_ATTEMPT_LIMIT = 5;
export const AUTH_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_ATTEMPT_KEY_PREFIX = 'viddi.auth.failures';

export interface SessionResult {
  session: Session | null;
  error: string | null;
}

/**
 * Ensures the app has a session with zero friction (Story 1.3 / FR15):
 *  - reuse an existing persisted session if there is one, else
 *  - create an anonymous session silently.
 *
 * Requires "Anonymous sign-ins" enabled in Supabase
 * (Authentication → Providers → Anonymous). If disabled, returns the error
 * so the UI can surface it rather than crashing.
 */
export async function ensureAnonymousSession(): Promise<SessionResult> {
  if (!supabaseConfigured) {
    return { session: null, error: 'Supabase is not configured' };
  }

  const existing = await supabase.auth.getSession();
  if (existing.data.session) {
    return { session: existing.data.session, error: null };
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    return { session: null, error: error.message };
  }
  return { session: data.session, error: null };
}

export interface AuthActionResult {
  ok: boolean;
  message: string;
}

function authAttemptKey(route: 'secureAccount' | 'signInWithEmail', email: string): string {
  return `${AUTH_ATTEMPT_KEY_PREFIX}.${route}.${email.toLowerCase()}`;
}

async function readAuthFailures(route: 'secureAccount' | 'signInWithEmail', email: string, now = Date.now()): Promise<number[]> {
  try {
    const raw = await AsyncStorage.getItem(authAttemptKey(route, email));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value) => typeof value === 'number' && now - value < AUTH_ATTEMPT_WINDOW_MS);
  } catch {
    return [];
  }
}

async function checkAuthAttemptLimit(route: 'secureAccount' | 'signInWithEmail', email: string): Promise<AuthActionResult | null> {
  const failures = await readAuthFailures(route, email);
  if (failures.length >= AUTH_ATTEMPT_LIMIT) {
    return { ok: false, message: 'Muitas tentativas. Tente novamente em 15 minutos.' };
  }
  return null;
}

async function recordAuthFailure(route: 'secureAccount' | 'signInWithEmail', email: string): Promise<void> {
  const now = Date.now();
  const failures = await readAuthFailures(route, email, now);
  failures.push(now);
  await AsyncStorage.setItem(authAttemptKey(route, email), JSON.stringify(failures.slice(-AUTH_ATTEMPT_LIMIT)));
}

async function clearAuthFailures(route: 'secureAccount' | 'signInWithEmail', email: string): Promise<void> {
  await AsyncStorage.removeItem(authAttemptKey(route, email));
}

/**
 * Convert the current anonymous account into a permanent one by attaching
 * email + password. The user.id is unchanged, so all points/history are kept
 * (Story 1.4 / FR29). Depending on Supabase "Confirm email" settings, a
 * confirmation email may be required before the email is active.
 */
export async function secureAccount(email: string, password: string): Promise<AuthActionResult> {
  if (!supabaseConfigured) return { ok: false, message: 'Supabase is not configured yet.' };
  const emailResult = validateEmailInput(email);
  if (!emailResult.ok) return { ok: false, message: emailResult.error! };
  const passwordResult = validatePasswordInput(password);
  if (!passwordResult.ok) return { ok: false, message: passwordResult.error! };

  const limited = await checkAuthAttemptLimit('secureAccount', emailResult.value!);
  if (limited) return limited;

  const { error } = await supabase.auth.updateUser({ email: emailResult.value!, password: passwordResult.value! });
  if (error) {
    await recordAuthFailure('secureAccount', emailResult.value!);
    return { ok: false, message: error.message };
  }
  await clearAuthFailures('secureAccount', emailResult.value!);
  return { ok: true, message: 'Conta salva! Se pedirmos, confirme pelo e-mail.' };
}

/** Returning user on a new device — sign in to load their persona/points/history. */
export async function signInWithEmail(email: string, password: string): Promise<AuthActionResult> {
  if (!supabaseConfigured) return { ok: false, message: 'Supabase is not configured yet.' };
  const emailResult = validateEmailInput(email);
  if (!emailResult.ok) return { ok: false, message: emailResult.error! };
  const passwordResult = validatePasswordInput(password);
  if (!passwordResult.ok) return { ok: false, message: passwordResult.error! };

  const limited = await checkAuthAttemptLimit('signInWithEmail', emailResult.value!);
  if (limited) return limited;

  const { error } = await supabase.auth.signInWithPassword({ email: emailResult.value!, password: passwordResult.value! });
  if (error) {
    await recordAuthFailure('signInWithEmail', emailResult.value!);
    return { ok: false, message: error.message };
  }
  await clearAuthFailures('signInWithEmail', emailResult.value!);
  return { ok: true, message: 'Bem-vindo de volta! 🎉' };
}
