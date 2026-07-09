import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const profileScreenSource = readFileSync(new URL('../src/screens/ProfileScreen.tsx', import.meta.url), 'utf8');

test('profile delete account flow only navigates after a successful deletion result', () => {
  assert.match(profileScreenSource, /const\s+result\s*=\s*await\s+deleteMyAccount\s*\(\s*\)/);
  assert.match(profileScreenSource, /if\s*\(\s*!result\.ok\s*\)/);
  assert.match(profileScreenSource, /return\s*;/);
  assert.match(profileScreenSource, /onDeleted\?\.\(\s*\)/);
  assert.ok(
    profileScreenSource.indexOf('if (!result.ok)') < profileScreenSource.indexOf('onDeleted?.()'),
    'failure branch must run before onDeleted callback',
  );
});

test('profile delete account flow surfaces failures and re-enables the confirm button', () => {
  assert.match(profileScreenSource, /const\s*\[deleteError,\s*setDeleteError\]\s*=\s*useState<string\s*\|\s*null>\s*\(\s*null\s*\)/);
  assert.match(profileScreenSource, /setDeleteError\s*\(\s*result\.error\s*\?\?\s*'Não foi possível deletar a conta agora\.'/);
  assert.match(profileScreenSource, /setDeleting\s*\(\s*false\s*\)/);
  assert.match(profileScreenSource, /deleteError\s*\?\s*<Text/);
});
