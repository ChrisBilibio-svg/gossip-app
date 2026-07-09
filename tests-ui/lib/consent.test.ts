/**
 * Terms & Privacy consent persistence (on-device). Guards the gate logic in
 * App.tsx: only the CURRENT terms version counts as accepted, so bumping the
 * version re-prompts the user. AsyncStorage uses the official in-memory mock.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getConsent, hasAcceptedCurrent, recordConsent } from '../../src/lib/consent';

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('no consent stored → not accepted', async () => {
  expect(await getConsent()).toBeNull();
  expect(await hasAcceptedCurrent('v1')).toBe(false);
});

test('recording consent persists the version and a timestamp', async () => {
  const rec = await recordConsent('v1');
  expect(rec.version).toBe('v1');
  expect(Number.isFinite(Date.parse(rec.acceptedAt))).toBe(true);
  expect(await getConsent()).toMatchObject({ version: 'v1' });
});

test('accepted only counts for the matching current version', async () => {
  await recordConsent('v1');
  expect(await hasAcceptedCurrent('v1')).toBe(true);
  expect(await hasAcceptedCurrent('v2')).toBe(false); // new terms → must re-accept
});

test('malformed stored JSON degrades to null, not a throw', async () => {
  await AsyncStorage.setItem('consent.terms', '{not json');
  await expect(getConsent()).resolves.toBeNull();
});
