// Jest config for the UI / runtime test suite (Test & Quality lane).
//
// Scope: this runner ONLY looks in `tests-ui/`. The existing backend suite in
// `tests/` runs under `node --test` via `npm test` and is left untouched, so
// the two runners never collide. Run this suite with `npm run test:ui`.
//
// Named `.cjs` because package.json sets "type": "module".
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/tests-ui'],
  setupFiles: ['<rootDir>/tests-ui/jest.setup.cjs'],
  // jest-expo already transpiles the React Native / Expo module graph. Extend
  // the ignore pattern so ESM-only deps we import in tests are transformed too.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@supabase/.*))',
  ],
};
