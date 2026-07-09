// config-preflight.mjs — validate required runtime config without leaking secrets.
//
// Non-mutating preflight for local/CI use. It checks that required Supabase env
// vars exist, are not placeholders, and that SUPABASE_URL looks like a real
// hosted Supabase project URL. Output is always redacted before printing.
//
// Env checked by default:
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const DEFAULT_REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const PLACEHOLDER_RE = /^(?:your[-_ ]?|example|changeme|change-me|todo|placeholder|xxx|null|undefined)/i;

export function findMissingRequiredEnv(env, requiredNames = DEFAULT_REQUIRED_ENV) {
  return requiredNames.filter((name) => !String(env[name] ?? '').trim());
}

export function isPlaceholderValue(value) {
  const text = String(value ?? '').trim();
  if (!text) return true;
  if (PLACEHOLDER_RE.test(text)) return true;
  if (/example\.(?:com|org|net|supabase\.co)/i.test(text)) return true;
  if (/your[-_ ]?(?:supabase|project|anon|service|key|url)/i.test(text)) return true;
  return false;
}

export function validateSupabaseUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return { ok: false, reason: 'must use https' };
    if (!url.hostname.endsWith('.supabase.co')) return { ok: false, reason: 'must end with .supabase.co' };
    if (isPlaceholderValue(value)) return { ok: false, reason: 'looks like a placeholder' };
    const projectRef = url.hostname.slice(0, -'.supabase.co'.length);
    if (!/^[a-z0-9-]{6,}$/.test(projectRef)) return { ok: false, reason: 'project ref is too short or invalid' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
}

export function redactSecretLikeText(text) {
  return String(text)
    .replace(/\b[A-Z0-9_]*(?:SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|API_KEY|TOKEN|SECRET|PASSWORD)=([^\s]+)/gi, (match) => {
      const [name] = match.split('=');
      return `${name}=[REDACTED_SECRET]`;
    })
    .replace(/eyJ[A-Za-z0-9_-]{4,}(?:\.{0,3}|\.\.\.)[A-Za-z0-9_-]{2,}(?:\.{0,3}|\.\.\.)[A-Za-z0-9_-]{2,}/g, '[REDACTED_JWT]')
    .replace(/\b(?:sk|pk|sb|ghp|github_pat|xoxb|xoxp|supabase)[A-Za-z0-9_\-.]{8,}\b/g, '[REDACTED_SECRET]');
}

export function validateConfig(env = process.env) {
  const errors = [];
  const warnings = [];
  const missing = findMissingRequiredEnv(env);
  for (const name of missing) errors.push(`Missing required env: ${name}`);

  for (const name of DEFAULT_REQUIRED_ENV) {
    const value = env[name];
    if (value && isPlaceholderValue(value)) errors.push(`${name} looks like a placeholder`);
  }

  if (env.SUPABASE_URL) {
    const urlCheck = validateSupabaseUrl(env.SUPABASE_URL);
    if (!urlCheck.ok) errors.push(`SUPABASE_URL invalid: ${urlCheck.reason}`);
  }

  for (const [name, value] of Object.entries(env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD/i.test(name) && typeof value === 'string' && value.length < 16) {
      warnings.push(`${name} is unusually short`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function hasGitignoreLine(gitignoreText, expected) {
  return String(gitignoreText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .includes(expected);
}

function isEnvFile(path) {
  const name = String(path).split('/').pop() ?? '';
  return name === '.env' || name.startsWith('.env.');
}

function isAllowedTrackedEnvFile(path) {
  const normalized = String(path).replace(/^\.\//, '');
  return normalized === '.env.example';
}

export function validateEnvFileSecurity({
  envFiles = [],
  trackedFiles = [],
  gitignoreText = '',
  gitInventoryError = null,
  effectiveIgnore = null,
} = {}) {
  const errors = [];
  const warnings = [];

  if (!hasGitignoreLine(gitignoreText, '.env')) errors.push('Missing gitignore pattern: .env');
  if (!hasGitignoreLine(gitignoreText, '.env.*')) errors.push('Missing gitignore pattern: .env.*');
  if (!hasGitignoreLine(gitignoreText, '!.env.example')) errors.push('Missing gitignore allowlist: !.env.example');

  if (gitInventoryError) errors.push(`Could not inspect git-tracked env files: ${gitInventoryError}`);

  if (effectiveIgnore) {
    const ignored = new Set(effectiveIgnore.ignored ?? []);
    const notIgnored = new Set(effectiveIgnore.notIgnored ?? []);
    for (const file of ['.env', '.env.local', '.env.production', '.env.staging']) {
      if (!ignored.has(file) || notIgnored.has(file)) errors.push(`Sensitive env file is not effectively ignored: ${file}`);
    }
    if (ignored.has('.env.example')) errors.push('Example env file should remain trackable: .env.example');
  }

  for (const file of trackedFiles.filter(isEnvFile)) {
    if (!isAllowedTrackedEnvFile(file)) errors.push(`Tracked non-example env file: ${file}`);
  }

  for (const file of envFiles.filter(isEnvFile)) {
    if (!isAllowedTrackedEnvFile(file) && !trackedFiles.includes(file)) {
      warnings.push(`Local env file present and untracked: ${file}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function collectLocalEnvFiles(cwd = process.cwd()) {
  const skipDirs = new Set(['.git', 'node_modules', 'ios', 'android', 'dist', 'web-build', '.expo']);
  const found = [];

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) walk(fullPath);
        continue;
      }

      if (entry.isFile() && isEnvFile(entry.name)) {
        found.push(relative(cwd, fullPath).replace(/\\/g, '/'));
      }
    }
  }

  walk(cwd);
  return found;
}

function collectEnvFileSecurityInput(cwd = process.cwd()) {
  const envFiles = collectLocalEnvFiles(cwd);
  const gitignorePath = join(cwd, '.gitignore');
  const gitignoreText = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  let trackedFiles = [];
  let gitInventoryError = null;
  const effectiveIgnore = { ignored: [], notIgnored: [] };

  try {
    trackedFiles = execFileSync('git', ['ls-files'], { cwd, encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean)
      .filter(isEnvFile);
  } catch (error) {
    trackedFiles = [];
    gitInventoryError = error instanceof Error ? error.message : String(error);
  }

  for (const file of ['.env', '.env.local', '.env.production', '.env.staging', '.env.example']) {
    try {
      execFileSync('git', ['check-ignore', '--quiet', file], { cwd, encoding: 'utf8' });
      effectiveIgnore.ignored.push(file);
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 1) {
        effectiveIgnore.notIgnored.push(file);
      } else {
        gitInventoryError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  return { envFiles, trackedFiles, gitignoreText, gitInventoryError, effectiveIgnore };
}

function mergeResults(...results) {
  return {
    ok: results.every((result) => result.ok),
    errors: results.flatMap((result) => result.errors),
    warnings: results.flatMap((result) => result.warnings),
  };
}

export function parsePreflightArgs(args = []) {
  const parsed = {
    ok: true,
    envFileSecurityOnly: false,
    showHelp: false,
    errors: [],
  };

  for (const arg of args) {
    if (arg === '--env-file-security-only') {
      parsed.envFileSecurityOnly = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.showHelp = true;
    } else {
      parsed.ok = false;
      parsed.errors.push(`Unknown config-preflight option: ${arg}`);
    }
  }

  return parsed;
}

export function buildPreflightResult({
  env = process.env,
  args = process.argv.slice(2),
  envFileSecurityInput = collectEnvFileSecurityInput(),
} = {}) {
  const parsedArgs = parsePreflightArgs(args);
  if (!parsedArgs.ok) {
    return { ok: false, errors: parsedArgs.errors, warnings: [] };
  }

  if (parsedArgs.envFileSecurityOnly) {
    return validateEnvFileSecurity(envFileSecurityInput);
  }

  return mergeResults(validateConfig(env), validateEnvFileSecurity(envFileSecurityInput));
}

function usage() {
  console.log(`Usage: node scripts/config-preflight.mjs

Validates required Supabase runtime env without making network calls. Fails if
required values are missing, placeholder-looking, or SUPABASE_URL is malformed.
Also checks that local env files are broadly gitignored and that only
.env.example is tracked. Use --env-file-security-only to run only the env-file
inventory/gitignore check without requiring Supabase secrets.
All printed output is redacted.

Required env:
  SUPABASE_URL
  SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
`);
}

function printResult(result) {
  const lines = [];
  lines.push(result.ok ? '✅ Config preflight passed.' : '❌ Config preflight failed.');
  for (const error of result.errors) lines.push(`error: ${error}`);
  for (const warning of result.warnings) lines.push(`warning: ${warning}`);
  console.log(redactSecretLikeText(lines.join('\n')));
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const result = buildPreflightResult();
  printResult(result);
  if (!result.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(redactSecretLikeText(e));
    process.exit(1);
  });
}
