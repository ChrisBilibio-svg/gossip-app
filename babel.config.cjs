// Babel config for the Expo app + jest-expo test transform.
// Named `.cjs` because package.json sets "type": "module" (a `.js` config
// using module.exports would be parsed as ESM and fail). The preset is the
// same `babel-preset-expo` Metro applies by default, so this does not change
// the app's runtime/bundle behavior — it only makes the config explicit so
// jest-expo's babel-jest transform can find it.
module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
