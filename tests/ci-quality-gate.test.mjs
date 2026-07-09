import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// Normalize CRLF -> LF so the line-anchored assertions below pass regardless of the
// platform's git checkout (Windows checks workflow files out with CRLF; CI uses LF).
const workflow = readFileSync(new URL('../.github/workflows/quality-gate.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('package exposes a local config preflight script for CI reuse', () => {
  assert.equal(packageJson.scripts['config:preflight'], 'node scripts/config-preflight.mjs');
});

test('quality gate workflow runs deterministic checks on push and manual dispatch', () => {
  assert.match(workflow, /^name: Quality Gate/m);
  assert.match(workflow, /on:\n[\s\S]*push:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\n\s+contents: read/);
  assert.match(
    workflow,
    /npm ci[\s\S]*npm run typecheck[\s\S]*npm test[\s\S]*npm run typecheck:ui[\s\S]*npm run test:ui[\s\S]*npm run config:preflight -- --env-file-security-only[\s\S]*npm run audit:deps/,
  );
});
