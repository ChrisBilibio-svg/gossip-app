import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package declares ESM mode so Node test imports TypeScript helper modules without reparsing warnings', () => {
  assert.equal(packageJson.type, 'module');
});
