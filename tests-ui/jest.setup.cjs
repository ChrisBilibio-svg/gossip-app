// Global test setup for the UI suite.
//
// AsyncStorage has no native module under jest, so any module that imports it
// (e.g. src/lib/supabase) throws at import time. Swap in the official in-memory
// mock for every test. See:
// https://react-native-async-storage.github.io/async-storage/docs/advanced/jest
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Quiet two KNOWN-BENIGN warnings only: React Native's `Animated` springs
// schedule state updates on timers that can fire just after a test settles,
// producing "act(...)" noise that is environmental (Animated + jest), not an
// app bug. We swallow exactly those strings and pass every other console.error
// through untouched, so genuine errors and test regressions stay visible.
const IGNORED_ERROR_FRAGMENTS = [
  'not configured to support act',
  'overlapping act() calls',
];
const realConsoleError = console.error.bind(console);
console.error = (...args) => {
  const first = typeof args[0] === 'string' ? args[0] : '';
  if (IGNORED_ERROR_FRAGMENTS.some((frag) => first.includes(frag))) return;
  realConsoleError(...args);
};
