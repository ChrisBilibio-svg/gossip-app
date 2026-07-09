# Security review — Fofoca / `pastorfred/gossip`

_Last reviewed: 2026-06-05. Scope: local checkout `/home/chris-bilibio/repos/gossip` on branch `main`, commit `116cbf8 feat: add feed keyword search`._

## Executive summary

I scanned the current tracked code and git history for obvious leaked secrets and reviewed the Supabase/RLS/admin/security-sensitive flows. I did **not** find a committed Supabase `service_role` key, Anthropic API key, password, `.env`, keystore, or private key in the current tree or the regex-based git-history scan.

The main security concerns are **not leaked secrets**; they are product/backend hardening items:

1. **High:** curator admin XSS risk from unescaped user-controlled content in `gossip-admin/admin.html`.
2. **Medium:** `place_bet()` does not explicitly block `is_draft = true` rumors.
3. **Medium:** evidence source `note` is publicly readable for published rumors and may leak curator/internal notes.
4. **Medium:** comment guidelines are client-enforced only; direct API inserts can bypass the gate.
5. **Medium:** public `profiles` read exposes user UUIDs and all profile stats to anonymous users.
6. **Low/Medium:** Supabase publishable key is hardcoded in the admin HTML. It is not a secret, but it increases discoverability and should be treated as public client config.
7. **Low:** GitHub Actions do not set minimal `permissions:`.

## What was scanned

### Commands run

```bash
git status --short --branch
git log -1 --oneline
git ls-files | grep -Ei '(^|/)(\.env|.*secret.*|.*key.*|.*token.*|credentials|service-account|firebase|google-services|keystore|jks|p8|p12|pem)(\.|$|/)'
git status --ignored --short | grep -E '(\.env|key|secret|token|jks|keystore)'
git grep -n -I -E '(SUPABASE_SERVICE_ROLE_KEY|service_role|ANTHROPIC_API_KEY|api[_-]?key|secret|password|passwd|token|Authorization:|Bearer |sb_secret_|sb_publishable_|eyJ[a-zA-Z0-9_-]{20,})' -- ':!package-lock.json' ':!node_modules'
git log --all -G '(sb_secret_|SUPABASE_SERVICE_ROLE_KEY\s*=|ANTHROPIC_API_KEY\s*=|service_role.*[A-Za-z0-9_-]{20,}|password\s*=\s*["'\'''][^"'\''']{6,})' --pretty=format:'%h %ad %s' --date=short -- ':!package-lock.json'
```

### Secret-scan result

- No tracked `.env` file found.
- `.env.example` contains only placeholders.
- No local ignored `.env`, keystore, token, or secret file was visible via `git status --ignored --short`.
- No `sb_secret_...`, Supabase `service_role` value, Anthropic key value, private key file, keystore, or real password literal was found by the regex scan.
- Current tracked references to secrets are GitHub Actions placeholders such as `${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}`, which is correct.
- A Supabase publishable key is hardcoded in `gossip-admin/admin.html`. This is not equivalent to a service-role secret, but it is publicly usable client configuration.

## Findings

### SEC-001 — Curator admin XSS via unescaped content

- **Severity:** High
- **Files:** `gossip-admin/admin.html`
- **Relevant areas:** `loadDrafts()`, `loadReports()`, and any future `innerHTML` interpolation
- **Issue:** The admin console builds HTML strings with `innerHTML`. Some values are escaped with `esc()`, but several user/content-controlled values are still interpolated raw:
  - draft `r.source_label`
  - draft `r.summary`
  - moderation `rep.reason`
  - moderation `rep.comments?.body`
  - moderation `rep.comments?.status`
- **Why it matters:** User comments are attacker-controlled. If a malicious comment renders as HTML/JS in the curator admin, the attacker could execute JavaScript in the curator's browser. Because the curator is authenticated to Supabase, this could perform curator-only operations using the curator's session.
- **Exploit example:** A comment body containing an HTML event handler or script-like payload could render in the moderation queue if not escaped.
- **Recommended fix:**
  - Escape **all** values inserted into `innerHTML` using `esc()`.
  - Prefer DOM APIs (`textContent`, `setAttribute`) over template-string `innerHTML` for user-controlled content.
  - Keep source URLs validated via `new URL()` and escaped before `href` interpolation.
- **Status:** Needs code fix.

### SEC-002 — `place_bet()` allows betting on drafts if a draft UUID leaks

- **Severity:** Medium
- **File:** `supabase/migrations/0002_predictions.sql`
- **Function:** `place_bet(p_rumor_id, p_choice)`
- **Issue:** The function checks:
  - authenticated user
  - rumor exists
  - `status = 'speculated'`
  - `publish_at <= now()`

  It does **not** check `coalesce(is_draft, false) = false`.
- **Why it matters:** Draft rumors are hidden by RLS, but if a draft UUID leaks through logs, admin XSS, screenshots, service-role automation, or any future endpoint, users could bet on unpublished drafts if `publish_at <= now()` and `status = 'speculated'`.
- **Recommended fix:** Add a new migration that replaces `place_bet()` with an explicit draft check:

```sql
if coalesce(v_rumor.is_draft, false) then
  raise exception 'rumor not published yet';
end if;
```

- **Status:** Needs code fix.

### SEC-003 — Evidence source notes are public for published rumors

- **Severity:** Medium
- **Files:**
  - `supabase/migrations/0012_evidence_sources.sql`
  - `src/lib/rumors.ts`
  - `src/components/RumorDetail.tsx` / evidence display surfaces
- **Issue:** Public readers can select rows from `rumor_evidence_sources` for published non-draft rumors. The selected data includes `note`.
- **Why it matters:** Curators may put internal reasoning, private caution notes, or non-public context in `note`. Because RLS allows public read, those notes may be visible to all users.
- **Recommended fix:**
  - Split `note` into `public_note` and `internal_note`, or
  - Remove `note` from public app selects and keep it admin-only via an RPC/view, or
  - Change RLS/data model so public evidence exposes only `source_url`, `source_label`, and `supports_outcome`.
- **Status:** Needs product decision + code fix.

### SEC-004 — Comment guidelines are enforced only in the client

- **Severity:** Medium
- **Files:**
  - `supabase/migrations/0005_comments.sql`
  - `src/components/CommentSection.tsx`
  - `src/lib/comments.ts`
- **Issue:** The UI checks `hasAcceptedGuidelines()` before posting, but the RLS insert policy only checks `user_id = auth.uid()`:

```sql
create policy "insert own comment" on comments for insert to authenticated
  with check (user_id = auth.uid());
```

- **Why it matters:** A user can bypass the app and call the Supabase REST API directly with the public anon key and their session token, inserting comments without accepting guidelines.
- **Recommended fix:** Update the insert policy or replace direct insert with an RPC so the database enforces guideline acceptance:

```sql
with check (
  user_id = auth.uid()
  and exists (
    select 1 from profiles
    where id = auth.uid()
      and accepted_guidelines = true
  )
)
```

- **Status:** Needs code fix.

### SEC-005 — Public profile table exposes user UUIDs and stats

- **Severity:** Medium for privacy / Low for direct compromise
- **File:** `supabase/migrations/0003_profiles.sql`
- **Issue:** The `profiles` table has a public read policy:

```sql
create policy "read profiles"
  on profiles for select
  to anon, authenticated
  using (true);
```

This can expose `id`, `handle`, `total_points`, `correct_count`, `resolved_count`, `created_at`, `accepted_guidelines`, and `is_curator` depending on selects and later columns.
- **Why it matters:** Public UUIDs are not passwords, but exposing stable user IDs plus stats can increase scraping, correlation, harassment, and privacy risk. Exposing `is_curator` publicly can also identify privileged accounts if selected.
- **Recommended fix:**
  - Replace broad public table access with a `leaderboard_public` view exposing only needed fields.
  - Restrict `profiles` table select to own profile + curator.
  - Avoid exposing `is_curator`, `accepted_guidelines`, and raw UUIDs to anonymous clients.
- **Status:** Needs code fix / migration.

### SEC-006 — Admin HTML no longer commits Supabase project config

- **Severity:** Low/Medium
- **File:** `gossip-admin/admin.html`
- **Current value:** none committed; the admin panel now reads `window.__VIDDI_ADMIN_CONFIG__`, `VIDDI_ADMIN_SUPABASE_URL`, or `VIDDI_ADMIN_SUPABASE_ANON_KEY` at runtime.
- **Issue:** The admin console previously embedded the Supabase URL and publishable key directly.
- **Why it matters:** Supabase anon/publishable keys are expected to be public in client apps, so this was not a leaked service secret. However, hardcoding the admin key/project made the admin target easy to discover and reuse. If any RLS policy is weak, this key makes exploitation easier.
- **Fix applied:** Removed the committed project URL/publishable key from `gossip-admin/admin.html`; deployment must inject public config at runtime.
- **Remaining recommendation:** Host admin behind additional access control if it is deployed publicly, and keep all admin authority in RLS/RPC checks.
- **Status:** Hardened in code; runtime config required before use.

### SEC-007 — GitHub Actions should use minimal permissions

- **Severity:** Low
- **Files:**
  - `.github/workflows/ingest.yml`
  - `.github/workflows/resolve-deadlines.yml`
- **Issue:** Workflows do not explicitly set permissions. GitHub's default may be broader than necessary depending on repository settings.
- **Recommended fix:** Add top-level read-only permissions:

```yaml
permissions:
  contents: read
```

- **Status:** Easy hardening.

### SEC-008 — Service-role keys in GitHub Actions are high-impact secrets

- **Severity:** Informational / operational high impact
- **Files:**
  - `.github/workflows/ingest.yml`
  - `.github/workflows/resolve-deadlines.yml`
  - `scripts/ingest.mjs`
  - `scripts/resolve-deadlines.mjs`
- **Issue:** Workflows correctly read `SUPABASE_SERVICE_ROLE_KEY` from GitHub Secrets and do not print it. But if the secret is exposed, it bypasses RLS and has broad database access.
- **Recommended controls:**
  - Restrict who can edit workflows and repository secrets.
  - Use GitHub environments with required reviewers for production secrets.
  - Rotate service-role key if there is any suspicion it was pasted into logs/chat/issues.
  - Consider dedicated least-privilege Postgres roles/RPC-only tokens for automation later, if feasible.
- **Status:** No leak found; operational control needed.

### SEC-009 — No database-level rate limits for comments/likes/reports/bets

- **Severity:** Medium for abuse/availability
- **Files:** `supabase/migrations/0002_predictions.sql`, `0005_comments.sql`
- **Issue:** RLS/RPC protects ownership and write-once betting, but there are no app-level/database-level rate limits for:
  - comments
  - reports
  - likes/unlikes
  - account creation / anonymous sessions
- **Why it matters:** Attackers can spam comments/reports or create many anonymous accounts. Supabase/Auth and platform-level controls may mitigate some of this, but the app should assume public clients are scriptable.
- **Recommended fix:**
  - Add server-side insert throttles using tables/functions/triggers for comments/reports.
  - Consider CAPTCHA or device/app attestation later.
  - Add moderation queue filters and bulk actions.
- **Status:** Product hardening backlog.

### SEC-010 — `set_handle()` lacks DB validation

- **Severity:** Low/Medium
- **File:** `supabase/migrations/0030_profile_handle_validation.sql`
- **Issue:** Earlier versions of `set_handle(p_handle)` trimmed and stored arbitrary text with no length, character, or reserved-name constraints.
- **Why it matters:** Handles render in UI and leaderboard. React Native text rendering avoids HTML injection, but unbounded/weird handles can cause UI abuse, impersonation, and moderation issues.
- **Fix:** Added migration `0030_profile_handle_validation.sql` to replace `set_handle()` with database-enforced lowercase 3–20 char `[a-z0-9_]` handles, reserved platform/admin names, and authenticated-only execute grants.
- **Status:** Code-ready; Chris must apply migration `0030` manually in Supabase.

### SEC-011 — Ingest AI output needs stricter validation before DB insert

- **Severity:** Low/Medium
- **Files:** `scripts/ingest.mjs`
- **Issue:** Claude output is parsed as JSON and inserted only if it passes strict local validation: `use === true`, accepted status, 20–180 char summary, and article length no more than 1200 chars. Accepted summary/article text is trimmed before insert.
- **Why it matters:** Prompt injection from RSS headlines/sources could cause off-brand or unsafe text. This is less of a secret leak and more content/legal safety.
- **Fix:** Added `shouldUseDraft()` in `scripts/ingest.mjs` with regression coverage in `tests/ingest.test.mjs`, so malformed/overlong Claude output is skipped before `insertRumor()`.
- **Recommended follow-up:**
  - Keep `AUTO_PUBLISH=false` until trusted.
  - Consider a second moderation/safety pass before drafts are shown to users.
- **Status:** Code-ready; drafts remain curator-reviewed by default.

### SEC-012 — 2026-06-16 hardening pass: rate limits, payload validation, secret scan

- **Severity:** Medium abuse reduction / High hygiene value
- **Files:**
  - `supabase/migrations/0036_security_input_rate_limits.sql`
  - `src/lib/inputValidation.ts`
  - `src/lib/auth.ts`
  - `src/lib/comments.ts`
  - `src/lib/social.ts`
  - `gossip-admin/admin.html`
  - `tests/security-hardening-contract.test.mjs`
- **Fixes applied:**
  - Added DB constraints rejecting HTML-like/script-like text, control characters, malformed push tokens/session IDs, oversized JSON payloads, and oversized text payloads.
  - Added DB rate-limit triggers for remaining client-writable tables: `content_reports`, `analytics_events`, `notification_preferences`, `push_devices`, and `blocks`.
  - Re-wrapped `set_handle()` and `set_avatar()` with rate limits.
  - Added client-side 5 failed attempts / 15 minutes limiter for `signInWithEmail()` and `secureAccount()`.
  - Centralized app text/UUID/email/password validation and wired comments/social writes through it, preserving emoji/4-byte Unicode with `Array.from()` codepoint counting.
  - Removed committed Supabase project URL/publishable key from `gossip-admin/admin.html`; admin now requires runtime config injection.
- **Secret-scan result:** Current tracked tree scan found no high-confidence service secrets, private keys, GitHub tokens, Anthropic/OpenAI keys, or Supabase publishable key literals. Placeholder/test Supabase URLs remain in tests and `.env.example` only. `gitleaks` was not installed locally, but CI already runs Gitleaks.
- **Git-history note:** Existing history contains the old Supabase publishable/anon key in `gossip-admin/admin.html` and earlier `SECURITY_REVIEW.md` revisions. This is public client config, not a service-role secret, but treat it as exposed forever. Rotate the anon/publishable key before production if you want a clean break; rewriting public git history is not recommended without explicit approval.
- **Status:** Code-ready; Chris must apply migration `0036` manually in Supabase.

## Confirmed safe / good practices observed

- `.env` is ignored in `.gitignore`.
- Native signing artifacts are ignored (`*.jks`, `*.p8`, `*.p12`, `*.key`, `*.pem`).
- Service-role and Anthropic keys are referenced through GitHub Actions secrets, not literal values.
- Supabase client app uses `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`; no service role in Expo app code.
- `resolve_rumor()` and `resolve_rumor_with_evidence()` check curator status for authenticated users.
- Deadline resolver is service-role only and dry-run by default.
- Public rumor reads exclude drafts after migration `0008`.
- Predictions are write-once with `unique(user_id, rumor_id)`.
- Comment bodies render safely in React Native app text nodes.

## Recommended remediation order

1. **Restrict public profile access** via a public leaderboard/profile view and own-profile policy.
2. **Make evidence notes private** or split public/internal notes if curator notes should not be exposed.
3. **Add GitHub Actions `permissions: contents: read`** to any remaining workflows that lack it.
4. **Keep `AUTO_PUBLISH=false`** until content validation and moderation are stronger.
5. **Run RLS adversarial tests** against a real Supabase project: anon, normal authenticated, curator, and service-role roles.
6. **Apply pending migrations in order** (`0032`–`0036`) and validate NOT VALID constraints after existing row cleanup.

## Cybersecurity handoff checklist

- [ ] Review Supabase Auth settings: anonymous sign-ins, email confirmation, password policy, refresh-token/session duration.
- [ ] Review Supabase API settings and confirm no service-role key was exposed outside GitHub Secrets / local machine.
- [ ] Verify GitHub repository secret access and workflow edit permissions.
- [ ] Confirm production admin hosting is not publicly discoverable without additional access control, or accept that RLS is the only admin boundary.
- [x] Run a dedicated secret scanner such as Gitleaks or TruffleHog in CI. `.github/workflows/secret-scan.yml` now runs Gitleaks on pushes and pull requests with read-only permissions and no product secrets. _(added 2026-06-10)_
- [ ] Run RLS adversarial tests: anon, normal authenticated, curator, service role.
- [x] Add security regression tests for `place_bet` draft rejection and comment guideline enforcement once patched. (`tests/security-migrations.test.mjs` covers `0014` and `0029`.)
