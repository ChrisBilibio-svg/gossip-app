import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const workflowDir = new URL('../.github/workflows/', import.meta.url);
const workflowFiles = readdirSync(workflowDir).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));

function readWorkflow(name) {
  return readFileSync(new URL(name, workflowDir), 'utf8');
}

test('all GitHub Actions workflows declare minimal read-only contents permissions', () => {
  assert.ok(workflowFiles.length > 0, 'expected at least one workflow file');

  for (const file of workflowFiles) {
    const workflow = readWorkflow(file);
    assert.match(workflow, /^permissions:\r?\n\s+contents:\s+read\s*$/m, `${file} should declare permissions: contents: read`);
    assert.doesNotMatch(workflow, /^\s+contents:\s+write\s*$/m, `${file} should not request contents: write`);
  }
});

test('secret scanning workflow runs Gitleaks on pushes and pull requests', () => {
  const workflow = readWorkflow('secret-scan.yml');

  assert.match(workflow, /^name:\s+Secret Scan\s*$/m);
  assert.match(workflow, /^on:\r?\n\s+pull_request:\s*\r?\n\s+push:\s*$/m);
  assert.match(workflow, /gitleaks\/gitleaks-action@v2/);
  assert.match(workflow, /GITHUB_TOKEN:\s+\$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY|ANTHROPIC_API_KEY/);
});

test('stateful scheduled workflows prevent overlapping production runs', () => {
  const statefulWorkflows = [
    'ingest.yml',
    'resolve-deadlines.yml',
    'snapshot-leaderboard-ranks.yml',
    'snapshot-rumor-odds.yml',
    'assign-daily-images.yml',
  ];

  for (const file of statefulWorkflows) {
    const workflow = readWorkflow(file);
    assert.match(workflow, /^concurrency:\r?\n\s+group:\s+\$\{\{ github\.workflow \}\}\s*\r?\n\s+cancel-in-progress:\s+false\s*$/m, `${file} should serialize overlapping scheduled/manual runs across refs`);
  }
});

test('daily image workflow runs after curation with server-only Pexels credentials', () => {
  const workflow = readWorkflow('assign-daily-images.yml');
  assert.match(workflow, /workflows:\s*\['Auto-curate & publish daily markets'\]/);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /cron:\s*'10 \*\/3 \* \* \*'/);
  assert.match(workflow, /node scripts\/assign-daily-images\.mjs --live/);
  assert.match(workflow, /SUPABASE_URL:-/);
  assert.match(workflow, /PEXELS_API_KEY:\s*\$\{\{ secrets\.PEXELS_API_KEY \}\}/);
  assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/);
  assert.doesNotMatch(workflow, /EXPO_PUBLIC_.*PEXELS/);
});

test('ingest workflow wires optional source adapter secrets without hardcoding values', () => {
  const workflow = readWorkflow('ingest.yml');

  for (const secret of ['NEWS_API_KEY', 'NEWS_API_PROVIDER', 'REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'X_BEARER_TOKEN', 'XAI_API_KEY', 'XAI_MAX_SEARCHES_PER_RUN', 'ENABLE_4CHAN']) {
    assert.ok(workflow.includes(`${secret}: $` + `{{ secrets.${secret} }}`), secret);
  }
  assert.match(workflow, /4chan is high-toxicity\/low-signal/);
});
