import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Local record of Terms & Privacy acceptance (Story 1.2 / FR30).
 * Stored on-device; once an account exists (Story 1.3+) this can also be
 * mirrored to the user row server-side.
 */

const KEY = 'consent.terms';

export interface ConsentRecord {
  version: string;
  acceptedAt: string; // ISO timestamp
}

export async function getConsent(): Promise<ConsentRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ConsentRecord) : null;
  } catch {
    return null;
  }
}

/** True only if the user accepted the CURRENT terms version. */
export async function hasAcceptedCurrent(currentVersion: string): Promise<boolean> {
  const record = await getConsent();
  return record?.version === currentVersion;
}

export async function recordConsent(version: string): Promise<ConsentRecord> {
  const record: ConsentRecord = { version, acceptedAt: new Date().toISOString() };
  await AsyncStorage.setItem(KEY, JSON.stringify(record));
  return record;
}
