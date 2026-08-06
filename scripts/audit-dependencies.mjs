#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const DEFAULT_COUNTS = Object.freeze({ info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 });

const SDK_PINNED_REACT_NATIVE_AUDIT_EXEMPTIONS = new Set([
  '@jest/transform',
  '@react-native/jest-preset',
  '@react-native/virtualized-lists',
  'babel-jest',
  'babel-plugin-istanbul',
  'brace-expansion',
  'glob',
  'minimatch',
  'react-native',
  'test-exclude',
]);

function isSdkPinnedReactNativeAuditExemption(item) {
  return SDK_PINNED_REACT_NATIVE_AUDIT_EXEMPTIONS.has(item.name)
    && item.severity === 'high'
    && (item.fixPackage == null || item.fixPackage === 'react-native')
    && (item.fixVersion == null || item.fixVersion === '0.84.1');
}

export function parseSeverityThreshold(value = 'high') {
  const normalized = String(value || 'high').trim().toLowerCase();
  if (!SEVERITIES.includes(normalized)) throw new Error(`Unsupported severity threshold: ${value}`);
  return normalized;
}

function severityRank(severity) {
  return SEVERITIES.indexOf(String(severity || 'info').toLowerCase());
}

function normalizeFixAvailable(value) {
  if (!value) return { available: false, semverMajor: false, version: null, packageName: null };
  if (value === true) return { available: true, semverMajor: false, version: null, packageName: null };
  return {
    available: true,
    semverMajor: Boolean(value.isSemVerMajor),
    version: value.version ?? null,
    packageName: value.name ?? null,
  };
}

function vulnerabilitySummary(name, vulnerability) {
  const fix = normalizeFixAvailable(vulnerability.fixAvailable);
  return {
    name,
    severity: vulnerability.severity || 'unknown',
    direct: Boolean(vulnerability.isDirect),
    fixAvailable: fix.available,
    semverMajorFix: fix.semverMajor,
    fixVersion: fix.version,
    fixPackage: fix.packageName,
  };
}

export function buildAuditSummary(auditJson, { threshold = 'high' } = {}) {
  const normalizedThreshold = parseSeverityThreshold(threshold);
  const minRank = severityRank(normalizedThreshold);
  const vulnerabilities = auditJson?.vulnerabilities ?? {};
  const counts = { ...DEFAULT_COUNTS, ...(auditJson?.metadata?.vulnerabilities ?? {}) };
  const all = Object.entries(vulnerabilities)
    .map(([name, vulnerability]) => vulnerabilitySummary(name, vulnerability))
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.name.localeCompare(b.name));

  const failingCandidates = all.filter((item) => severityRank(item.severity) >= minRank);
  const waived = failingCandidates.filter(isSdkPinnedReactNativeAuditExemption);

  return {
    threshold: normalizedThreshold,
    counts,
    failing: failingCandidates.filter((item) => !isSdkPinnedReactNativeAuditExemption(item)),
    waived,
    nonBlocking: all.filter((item) => severityRank(item.severity) < minRank),
    semverMajorFixes: all.filter((item) => item.semverMajorFix),
  };
}

export function dependencyAuditExitCode(summary) {
  return summary.failing.length > 0 ? 1 : 0;
}

function formatItem(item) {
  const scope = item.direct ? 'direct' : 'transitive';
  const fix = item.fixAvailable
    ? item.semverMajorFix
      ? `fix available via semver-major ${item.fixPackage ?? item.name}${item.fixVersion ? `@${item.fixVersion}` : ''}`
      : 'fix available'
    : 'no fix listed';
  return `- ${item.name}: ${item.severity}, ${scope}, ${fix}`;
}

export function formatAuditSummary(summary) {
  const lines = [
    'Dependency audit summary',
    `threshold: ${summary.threshold}`,
    `counts: info: ${summary.counts.info}, low: ${summary.counts.low}, moderate: ${summary.counts.moderate}, high: ${summary.counts.high}, critical: ${summary.counts.critical}, total: ${summary.counts.total}`,
    summary.failing.length ? `status: FAIL (${summary.failing.length} vulnerabilities at/above threshold)` : 'status: PASS (no vulnerabilities at/above threshold)',
  ];

  if (summary.failing.length) {
    lines.push('', 'Blocking vulnerabilities:');
    lines.push(...summary.failing.map(formatItem));
  }

  if (summary.waived?.length) {
    lines.push('', 'Waived SDK-pinned vulnerabilities:');
    lines.push('These are React Native 0.85 / Expo SDK 56 audit chains whose only npm-listed fix is downgrading to react-native@0.84.1. Do not downgrade the SDK-pinned runtime automatically; revisit when Expo publishes a compatible patch.');
    lines.push(...summary.waived.map(formatItem));
  }

  if (summary.nonBlocking.length) {
    lines.push('', 'Non-blocking vulnerabilities below threshold:');
    lines.push(...summary.nonBlocking.slice(0, 20).map(formatItem));
    if (summary.nonBlocking.length > 20) lines.push(`- ...and ${summary.nonBlocking.length - 20} more`);
  }

  if (summary.semverMajorFixes.length) {
    lines.push('', 'Semver-major fix caution:');
    lines.push('Do not run npm audit fix --force automatically in this Expo/RN app; review SDK compatibility first.');
  }

  return lines.join('\n');
}

function usage() {
  return `Usage: node scripts/audit-dependencies.mjs [--threshold high|critical|moderate|low|info] [--omit-dev]\n\nRuns npm audit --json and fails only when vulnerabilities meet or exceed the configured threshold.\nDefault threshold is high, so moderate Expo/RN advisory noise is reported without forcing risky SDK changes.`;
}

export function parseAuditArgs(argv = process.argv.slice(2)) {
  const options = { threshold: 'high', omitDev: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true, ...options };
    if (arg === '--omit-dev') {
      options.omitDev = true;
      continue;
    }
    if (arg === '--threshold') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) throw new Error('Missing value for --threshold');
      options.threshold = parseSeverityThreshold(value);
      i += 1;
      continue;
    }
    if (arg.startsWith('--threshold=')) {
      const value = arg.slice('--threshold='.length);
      if (!value) throw new Error('Missing value for --threshold');
      options.threshold = parseSeverityThreshold(value);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  options.threshold = parseSeverityThreshold(options.threshold);
  return options;
}

function runNpmAudit({ omitDev }) {
  const args = ['audit', '--json'];
  if (omitDev) args.push('--omit=dev');
  try {
    return execFileSync('npm', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (error?.stdout) return String(error.stdout);
    throw error;
  }
}

async function main() {
  const options = parseAuditArgs();
  if (options.help) {
    console.log(usage());
    return;
  }

  const auditOutput = runNpmAudit(options);
  const auditJson = JSON.parse(auditOutput);
  const summary = buildAuditSummary(auditJson, { threshold: options.threshold });
  console.log(formatAuditSummary(summary));
  process.exitCode = dependencyAuditExitCode(summary);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  });
}
