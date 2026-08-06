import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAuditSummary,
  dependencyAuditExitCode,
  formatAuditSummary,
  parseAuditArgs,
  parseSeverityThreshold,
} from '../scripts/audit-dependencies.mjs';

const sampleAudit = {
  vulnerabilities: {
    expo: {
      name: 'expo',
      severity: 'moderate',
      isDirect: true,
      fixAvailable: { name: 'expo', version: '46.0.21', isSemVerMajor: true },
      via: ['@expo/cli'],
    },
    lodash: {
      name: 'lodash',
      severity: 'high',
      isDirect: false,
      fixAvailable: true,
      via: [{ name: 'lodash', severity: 'high' }],
    },
  },
  metadata: {
    vulnerabilities: { info: 0, low: 0, moderate: 1, high: 1, critical: 0, total: 2 },
  },
};

test('parseSeverityThreshold defaults to high and accepts known severities', () => {
  assert.equal(parseSeverityThreshold(undefined), 'high');
  assert.equal(parseSeverityThreshold('moderate'), 'moderate');
  assert.equal(parseSeverityThreshold('critical'), 'critical');
  assert.throws(() => parseSeverityThreshold('weird'), /Unsupported severity threshold/);
});

test('buildAuditSummary counts severities and highlights semver-major fixes', () => {
  const summary = buildAuditSummary(sampleAudit, { threshold: 'high' });

  assert.deepEqual(summary.counts, { info: 0, low: 0, moderate: 1, high: 1, critical: 0, total: 2 });
  assert.equal(summary.failing.length, 1);
  assert.equal(summary.failing[0].name, 'lodash');
  assert.equal(summary.nonBlocking.length, 1);
  assert.equal(summary.nonBlocking[0].name, 'expo');
  assert.equal(summary.semverMajorFixes.length, 1);
  assert.equal(summary.semverMajorFixes[0].name, 'expo');
});

test('parseAuditArgs rejects a missing threshold value instead of silently using the default', () => {
  assert.throws(() => parseAuditArgs(['--threshold']), /Missing value for --threshold/);
});

test('dependencyAuditExitCode fails only when threshold or above vulnerabilities exist', () => {
  assert.equal(dependencyAuditExitCode(buildAuditSummary(sampleAudit, { threshold: 'critical' })), 0);
  assert.equal(dependencyAuditExitCode(buildAuditSummary(sampleAudit, { threshold: 'high' })), 1);
  assert.equal(dependencyAuditExitCode(buildAuditSummary(sampleAudit, { threshold: 'moderate' })), 1);
});

test('SDK-pinned React Native audit chain is waived when npm only suggests a downgrade', () => {
  const summary = buildAuditSummary({
    vulnerabilities: {
      'react-native': {
        name: 'react-native',
        severity: 'high',
        isDirect: true,
        fixAvailable: { name: 'react-native', version: '0.84.1', isSemVerMajor: true },
        via: ['@react-native/jest-preset'],
      },
      '@react-native/virtualized-lists': {
        name: '@react-native/virtualized-lists',
        severity: 'high',
        isDirect: false,
        fixAvailable: true,
        via: ['react-native'],
      },
      lodash: {
        name: 'lodash',
        severity: 'high',
        isDirect: false,
        fixAvailable: true,
        via: [{ name: 'lodash', severity: 'high' }],
      },
    },
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 3, critical: 0, total: 3 } },
  }, { threshold: 'high' });

  assert.deepEqual(summary.failing.map((item) => item.name), ['lodash']);
  assert.deepEqual(summary.waived.map((item) => item.name), ['@react-native/virtualized-lists', 'react-native']);
  assert.equal(dependencyAuditExitCode(summary), 1);
  assert.match(formatAuditSummary(summary), /Waived SDK-pinned vulnerabilities/);
});

test('formatAuditSummary is human-readable without dumping raw advisory data', () => {
  const summary = buildAuditSummary(sampleAudit, { threshold: 'high' });
  const output = formatAuditSummary(summary);

  assert.match(output, /Dependency audit summary/);
  assert.match(output, /moderate: 1/);
  assert.match(output, /high: 1/);
  assert.match(output, /FAIL/);
  assert.match(output, /lodash/);
  assert.match(output, /semver-major/);
  assert.doesNotMatch(output, /payload|signature|SUPABASE_SERVICE_ROLE_KEY/);
});
