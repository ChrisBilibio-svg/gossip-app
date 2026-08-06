import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const placeBetDraftGuardMigration = readFileSync(new URL('../supabase/migrations/0014_place_bet_draft_guard.sql', import.meta.url), 'utf8');
const denormalizedReactionCountsMigration = readFileSync(
  new URL('../supabase/migrations/0015_denormalize_rumor_reaction_counts.sql', import.meta.url),
  'utf8',
);
const singleFeedRpcMigration = readFileSync(new URL('../supabase/migrations/0016_single_feed_rpc.sql', import.meta.url), 'utf8');
const atomicPlaceBetCounterMigration = readFileSync(
  new URL('../supabase/migrations/0017_atomic_place_bet_counter.sql', import.meta.url),
  'utf8',
);
const rateLimitWritesMigration = readFileSync(new URL('../supabase/migrations/0018_rate_limit_writes.sql', import.meta.url), 'utf8');
const serverSearchRpcMigration = readFileSync(new URL('../supabase/migrations/0019_server_search_rpc.sql', import.meta.url), 'utf8');
const leaderboardRankDeltaMigration = readFileSync(
  new URL('../supabase/migrations/0020_leaderboard_rank_delta.sql', import.meta.url),
  'utf8',
);
const adminAuditLogMigration = readFileSync(new URL('../supabase/migrations/0021_admin_audit_log.sql', import.meta.url), 'utf8');
const contentReportsMigration = readFileSync(new URL('../supabase/migrations/0022_content_reports.sql', import.meta.url), 'utf8');
const notificationPreferencesMigration = readFileSync(
  new URL('../supabase/migrations/0023_notification_preferences.sql', import.meta.url),
  'utf8',
);
const analyticsEventsMigration = readFileSync(new URL('../supabase/migrations/0024_analytics_events.sql', import.meta.url), 'utf8');
const moderationQueueMigration = readFileSync(new URL('../supabase/migrations/0025_moderation_queue_rpc.sql', import.meta.url), 'utf8');
const moderationAuditMigration = readFileSync(new URL('../supabase/migrations/0026_moderation_audit_triggers.sql', import.meta.url), 'utf8');
const socialRepostRepliesMigration = readFileSync(new URL('../supabase/migrations/0027_social_repost_replies.sql', import.meta.url), 'utf8');
const hybridResolutionMigration = readFileSync(new URL('../supabase/migrations/0028_hybrid_resolution_model.sql', import.meta.url), 'utf8');
const commentGuidelineMigration = readFileSync(new URL('../supabase/migrations/0029_comment_guideline_insert_guard.sql', import.meta.url), 'utf8');
const editorialImagesMigration = readFileSync(new URL('../supabase/migrations/0064_featured_category_editorial_images.sql', import.meta.url), 'utf8');

test('editorial image migration enforces complete attributed metadata and one winner per category/day', () => {
  assert.match(editorialImagesMigration, /num_nonnulls\s*\([\s\S]*\)\s+in\s*\(\s*0\s*,\s*9\s*\)/i);
  assert.match(editorialImagesMigration, /editorial_image_provider\s*=\s*'pexels'/i);
  assert.match(editorialImagesMigration, /create\s+unique\s+index[\s\S]*lower\s*\(\s*translate\s*\(\s*btrim\s*\(\s*category\s*\)[\s\S]*editorial_image_feature_date/i);
});

test('editorial assignment RPC is atomic, eligible-only, and service-role-only', () => {
  assert.match(editorialImagesMigration, /create\s+or\s+replace\s+function\s+service_assign_daily_editorial_image/i);
  assert.match(editorialImagesMigration, /for\s+update/i);
  assert.match(editorialImagesMigration, /pg_advisory_xact_lock\s*\(/i);
  assert.match(editorialImagesMigration, /v_target\.status::text\s*<>\s*'speculated'/i);
  assert.match(editorialImagesMigration, /publish_at\s+at\s+time\s+zone\s+'America\/Sao_Paulo'[\s\S]*p_feature_date/i);
  assert.match(editorialImagesMigration, /order\s+by\s+r\.publish_at\s+desc[\s\S]*v_newest_id\s+is\s+distinct\s+from\s+p_rumor_id/i);
  assert.match(editorialImagesMigration, /update\s+rumors[\s\S]*editorial_image_url\s*=\s*null[\s\S]*update\s+rumors[\s\S]*editorial_image_provider\s*=\s*'pexels'/i);
  assert.match(editorialImagesMigration, /revoke\s+all[\s\S]*from\s+anon,\s*authenticated/i);
  assert.match(editorialImagesMigration, /grant\s+execute[\s\S]*to\s+service_role/i);
  assert.doesNotMatch(editorialImagesMigration, /create\s+or\s+replace\s+function\s+(get_feed|search_rumors)/i);
});

test('place_bet migration blocks bets on draft rumors', () => {
  assert.match(placeBetDraftGuardMigration, /create\s+or\s+replace\s+function\s+place_bet\s*\(/i);
  assert.match(placeBetDraftGuardMigration, /if\s+coalesce\s*\(\s*v_rumor\.is_draft\s*,\s*false\s*\)\s+then/i);
  assert.match(placeBetDraftGuardMigration, /raise\s+exception\s+'rumor not open'/i);
});

test('place_bet migration preserves authenticated-only execute grant', () => {
  assert.match(placeBetDraftGuardMigration, /grant\s+execute\s+on\s+function\s+place_bet\s*\(\s*uuid\s*,\s*bet_choice\s*\)\s+to\s+authenticated/i);
});

test('rumor reaction count migration denormalizes counts onto rumors', () => {
  assert.match(denormalizedReactionCountsMigration, /alter\s+table\s+rumors[\s\S]*add\s+column\s+if\s+not\s+exists\s+like_count/i);
  assert.match(denormalizedReactionCountsMigration, /add\s+column\s+if\s+not\s+exists\s+dislike_count/i);
  assert.match(denormalizedReactionCountsMigration, /create\s+or\s+replace\s+function\s+bump_rumor_reaction_counts\s*\(/i);
  assert.match(denormalizedReactionCountsMigration, /after\s+insert\s+on\s+rumor_reactions/i);
  assert.match(denormalizedReactionCountsMigration, /after\s+update\s+on\s+rumor_reactions/i);
  assert.match(denormalizedReactionCountsMigration, /after\s+delete\s+on\s+rumor_reactions/i);
});

test('rumor reaction count migration keeps summary view as compatibility shim', () => {
  assert.match(denormalizedReactionCountsMigration, /create\s+or\s+replace\s+view\s+rumor_reaction_summary\s+as/i);
  assert.match(denormalizedReactionCountsMigration, /select\s+id\s+as\s+rumor_id,\s*like_count,\s*dislike_count\s+from\s+rumors/i);
  assert.match(denormalizedReactionCountsMigration, /grant\s+select\s+on\s+rumor_reaction_summary\s+to\s+anon,\s*authenticated/i);
});

test('single feed RPC returns feed plus caller-specific state in one function', () => {
  assert.match(singleFeedRpcMigration, /create\s+or\s+replace\s+function\s+get_feed\s*\(\s*p_limit\s+integer\s+default\s+30\s*\)/i);
  assert.match(singleFeedRpcMigration, /security\s+definer/i);
  assert.match(singleFeedRpcMigration, /where\s+r\.publish_at\s+<=\s+now\s*\(\s*\)/i);
  assert.match(singleFeedRpcMigration, /coalesce\s*\(\s*r\.is_draft\s*,\s*false\s*\)\s*=\s*false/i);
  assert.match(singleFeedRpcMigration, /p\.user_id\s*=\s*auth\.uid\s*\(\s*\)/i);
  assert.match(singleFeedRpcMigration, /rr\.user_id\s*=\s*auth\.uid\s*\(\s*\)/i);
});

test('single feed RPC includes evidence JSON and grants safe execute roles', () => {
  assert.match(singleFeedRpcMigration, /jsonb_agg\s*\(/i);
  assert.match(singleFeedRpcMigration, /rumor_evidence_sources\s+jsonb/i);
  assert.match(singleFeedRpcMigration, /revoke\s+all\s+on\s+function\s+get_feed\s*\(\s*integer\s*\)\s+from\s+public/i);
  assert.match(singleFeedRpcMigration, /grant\s+execute\s+on\s+function\s+get_feed\s*\(\s*integer\s*\)\s+to\s+anon,\s*authenticated/i);
});

test('atomic place_bet migration updates counters with UPDATE RETURNING', () => {
  assert.match(atomicPlaceBetCounterMigration, /create\s+or\s+replace\s+function\s+place_bet\s*\(/i);
  assert.doesNotMatch(atomicPlaceBetCounterMigration, /for\s+update/i);
  assert.match(atomicPlaceBetCounterMigration, /with\s+updated_rumor\s+as\s*\(\s*update\s+rumors/i);
  assert.match(atomicPlaceBetCounterMigration, /returning[\s\S]*previous_true_votes[\s\S]*previous_false_votes/i);
  assert.match(atomicPlaceBetCounterMigration, /insert\s+into\s+predictions[\s\S]*from\s+updated_rumor/i);
});

test('atomic place_bet migration preserves draft guard and authenticated grant', () => {
  assert.match(atomicPlaceBetCounterMigration, /coalesce\s*\(\s*is_draft\s*,\s*false\s*\)\s*=\s*false/i);
  assert.match(atomicPlaceBetCounterMigration, /publish_at\s+<=\s+now\s*\(\s*\)/i);
  assert.match(atomicPlaceBetCounterMigration, /grant\s+execute\s+on\s+function\s+place_bet\s*\(\s*uuid\s*,\s*bet_choice\s*\)\s+to\s+authenticated/i);
});

test('rate limit migration creates per-user fixed-window limiter', () => {
  assert.match(rateLimitWritesMigration, /create\s+table\s+if\s+not\s+exists\s+user_rate_limits/i);
  assert.match(rateLimitWritesMigration, /primary\s+key\s*\(\s*user_id\s*,\s*action\s*\)/i);
  assert.match(rateLimitWritesMigration, /create\s+or\s+replace\s+function\s+check_rate_limit\s*\(/i);
  assert.match(rateLimitWritesMigration, /for\s+update/i);
  assert.match(rateLimitWritesMigration, /raise\s+exception\s+'rate limit exceeded'/i);
  assert.match(rateLimitWritesMigration, /revoke\s+all\s+on\s+function\s+check_rate_limit\s*\(\s*text\s*,\s*interval\s*,\s*integer\s*\)\s+from\s+public/i);
});

test('rate limit migration protects comments reactions reposts and reports with triggers', () => {
  for (const triggerName of [
    'comments_rate_limit',
    'comment_likes_rate_limit',
    'rumor_reactions_rate_limit_ins',
    'rumor_reactions_rate_limit_upd',
    'social_reposts_rate_limit',
    'social_repost_reactions_rate_limit_ins',
    'social_repost_reactions_rate_limit_upd',
    'comment_reports_rate_limit',
  ]) {
    assert.match(rateLimitWritesMigration, new RegExp(`create\\s+trigger\\s+${triggerName}`, 'i'));
  }
});

test('rate limit migration routes bets through the limiter', () => {
  assert.match(rateLimitWritesMigration, /create\s+or\s+replace\s+function\s+place_bet\s*\(/i);
  assert.match(rateLimitWritesMigration, /perform\s+check_rate_limit\s*\(\s*'bets'\s*,\s*interval\s+'1 minute'\s*,\s*20\s*\)/i);
  assert.match(rateLimitWritesMigration, /with\s+updated_rumor\s+as\s*\(\s*update\s+rumors/i);
});

test('server-side search migration exposes a catalog search RPC', () => {
  assert.match(serverSearchRpcMigration, /create\s+or\s+replace\s+function\s+search_rumors\s*\(\s*p_query\s+text\s*,\s*p_limit\s+integer\s+default\s+50\s*\)/i);
  assert.match(serverSearchRpcMigration, /security\s+definer/i);
  assert.match(serverSearchRpcMigration, /where\s+r\.publish_at\s+<=\s+now\s*\(\s*\)/i);
  assert.match(serverSearchRpcMigration, /coalesce\s*\(\s*r\.is_draft\s*,\s*false\s*\)\s*=\s*false/i);
  assert.match(serverSearchRpcMigration, /lower\s*\(\s*unaccent\s*\(\s*coalesce\s*\(\s*r\.summary\s*,\s*''\s*\)\s*\)\s*\)\s+ilike/i);
  assert.match(serverSearchRpcMigration, /lower\s*\(\s*unaccent\s*\(\s*coalesce\s*\(\s*r\.article\s*,\s*''\s*\)\s*\)\s*\)\s+ilike/i);
  assert.match(serverSearchRpcMigration, /order\s+by\s+r\.created_at\s+desc/i);
});

test('server-side search migration returns feed-compatible rows and safe execute grants', () => {
  assert.match(serverSearchRpcMigration, /returns\s+table\s*\([\s\S]*rumor_evidence_sources\s+jsonb/i);
  assert.match(serverSearchRpcMigration, /p\.user_id\s*=\s*auth\.uid\s*\(\s*\)/i);
  assert.match(serverSearchRpcMigration, /rr\.user_id\s*=\s*auth\.uid\s*\(\s*\)/i);
  assert.match(serverSearchRpcMigration, /revoke\s+all\s+on\s+function\s+search_rumors\s*\(\s*text\s*,\s*integer\s*\)\s+from\s+public/i);
  assert.match(serverSearchRpcMigration, /grant\s+execute\s+on\s+function\s+search_rumors\s*\(\s*text\s*,\s*integer\s*\)\s+to\s+anon,\s*authenticated/i);
});

test('leaderboard rank delta migration snapshots daily profile ranks', () => {
  assert.match(leaderboardRankDeltaMigration, /create\s+table\s+if\s+not\s+exists\s+leaderboard_rank_snapshots/i);
  assert.match(leaderboardRankDeltaMigration, /primary\s+key\s*\(\s*profile_id\s*,\s*snapshot_date\s*\)/i);
  assert.match(leaderboardRankDeltaMigration, /create\s+or\s+replace\s+function\s+snapshot_leaderboard_ranks\s*\(\s*p_snapshot_date\s+date\s+default\s+current_date\s*\)/i);
  assert.match(leaderboardRankDeltaMigration, /row_number\s*\(\s*\)\s+over\s*\([\s\S]*order\s+by\s+total_points\s+desc/i);
  assert.match(leaderboardRankDeltaMigration, /on\s+conflict\s*\(\s*profile_id\s*,\s*snapshot_date\s*\)\s+do\s+update/i);
  assert.match(leaderboardRankDeltaMigration, /revoke\s+all\s+on\s+function\s+snapshot_leaderboard_ranks\s*\(\s*date\s*\)\s+from\s+public/i);
});

test('leaderboard rank delta migration exposes current ranks with movement', () => {
  assert.match(leaderboardRankDeltaMigration, /create\s+or\s+replace\s+function\s+get_leaderboard\s*\(\s*p_limit\s+integer\s+default\s+100\s*\)/i);
  assert.match(leaderboardRankDeltaMigration, /returns\s+table\s*\([\s\S]*rank_delta\s+integer/i);
  assert.match(leaderboardRankDeltaMigration, /where\s+snapshot_date\s+<\s+current_date/i);
  assert.match(leaderboardRankDeltaMigration, /pr\.rank\s+-\s+cr\.rank\s+end\s+as\s+rank_delta/i);
  assert.match(leaderboardRankDeltaMigration, /grant\s+execute\s+on\s+function\s+get_leaderboard\s*\(\s*integer\s*\)\s+to\s+anon,\s*authenticated/i);
});

test('admin audit log migration creates append-only client-private table', () => {
  assert.match(adminAuditLogMigration, /create\s+table\s+if\s+not\s+exists\s+admin_audit_events/i);
  assert.match(adminAuditLogMigration, /actor_id\s+uuid\s+references\s+auth\.users\s*\(\s*id\s*\)/i);
  assert.match(adminAuditLogMigration, /metadata\s+jsonb\s+not\s+null\s+default\s+'\{\}'::jsonb/i);
  assert.match(adminAuditLogMigration, /alter\s+table\s+admin_audit_events\s+enable\s+row\s+level\s+security/i);
  assert.match(adminAuditLogMigration, /revoke\s+all\s+on\s+admin_audit_events\s+from\s+anon,\s*authenticated/i);
});

test('admin audit log migration exposes service-role logging function only', () => {
  assert.match(adminAuditLogMigration, /create\s+or\s+replace\s+function\s+log_admin_audit_event\s*\(/i);
  assert.match(adminAuditLogMigration, /security\s+definer/i);
  assert.match(adminAuditLogMigration, /if\s+length\s*\(\s*btrim\s*\(\s*p_action\s*\)\s*\)\s*=\s*0\s+then/i);
  assert.match(adminAuditLogMigration, /insert\s+into\s+admin_audit_events/i);
  assert.match(adminAuditLogMigration, /grant\s+execute\s+on\s+function\s+log_admin_audit_event[\s\S]*to\s+service_role/i);
});

test('content reports migration tracks non-comment abuse reports', () => {
  assert.match(contentReportsMigration, /create\s+table\s+if\s+not\s+exists\s+content_reports/i);
  assert.match(contentReportsMigration, /target_type\s+text\s+not\s+null\s+check\s*\([\s\S]*'rumor'[\s\S]*'social_repost'[\s\S]*'profile'/i);
  assert.match(contentReportsMigration, /reporter_id\s+uuid\s+not\s+null\s+references\s+auth\.users\s*\(\s*id\s*\)\s+default\s+auth\.uid\s*\(\s*\)/i);
  assert.match(contentReportsMigration, /unique\s*\(\s*target_type\s*,\s*target_id\s*,\s*reporter_id\s*\)/i);
  assert.match(contentReportsMigration, /status\s+text\s+not\s+null\s+default\s+'open'/i);
});

test('content reports migration protects client and curator access', () => {
  assert.match(contentReportsMigration, /alter\s+table\s+content_reports\s+enable\s+row\s+level\s+security/i);
  assert.match(contentReportsMigration, /create\s+policy\s+"insert own content report"[\s\S]*with\s+check\s*\(\s*reporter_id\s*=\s*auth\.uid\s*\(\s*\)\s*\)/i);
  assert.match(contentReportsMigration, /create\s+policy\s+"read own content reports"[\s\S]*using\s*\(\s*reporter_id\s*=\s*auth\.uid\s*\(\s*\)\s*\)/i);
  assert.match(contentReportsMigration, /create\s+policy\s+"curator read content reports"[\s\S]*using\s*\(\s*is_curator\s*\(\s*\)\s*\)/i);
  assert.match(contentReportsMigration, /create\s+policy\s+"curator update content reports"[\s\S]*with\s+check\s*\(\s*is_curator\s*\(\s*\)\s*\)/i);
});

test('notification preferences migration stores opt-in settings and device tokens', () => {
  assert.match(notificationPreferencesMigration, /create\s+table\s+if\s+not\s+exists\s+notification_preferences/i);
  assert.match(notificationPreferencesMigration, /user_id\s+uuid\s+primary\s+key\s+references\s+auth\.users\s*\(\s*id\s*\)/i);
  assert.match(notificationPreferencesMigration, /breaking_news\s+boolean\s+not\s+null\s+default\s+true/i);
  assert.match(notificationPreferencesMigration, /resolution_updates\s+boolean\s+not\s+null\s+default\s+true/i);
  assert.match(notificationPreferencesMigration, /create\s+table\s+if\s+not\s+exists\s+push_devices/i);
  assert.match(notificationPreferencesMigration, /expo_push_token\s+text\s+not\s+null\s+unique/i);
  assert.match(notificationPreferencesMigration, /platform\s+text\s+not\s+null\s+check\s*\([\s\S]*'ios'[\s\S]*'android'[\s\S]*'web'/i);
});

test('notification preferences migration scopes rows to the current user', () => {
  assert.match(notificationPreferencesMigration, /alter\s+table\s+notification_preferences\s+enable\s+row\s+level\s+security/i);
  assert.match(notificationPreferencesMigration, /alter\s+table\s+push_devices\s+enable\s+row\s+level\s+security/i);
  assert.match(notificationPreferencesMigration, /create\s+policy\s+"read own notification preferences"[\s\S]*using\s*\(\s*user_id\s*=\s*auth\.uid\s*\(\s*\)\s*\)/i);
  assert.match(notificationPreferencesMigration, /create\s+policy\s+"upsert own notification preferences"[\s\S]*with\s+check\s*\(\s*user_id\s*=\s*auth\.uid\s*\(\s*\)\s*\)/i);
  assert.match(notificationPreferencesMigration, /create\s+policy\s+"manage own push devices"[\s\S]*using\s*\(\s*user_id\s*=\s*auth\.uid\s*\(\s*\)\s*\)[\s\S]*with\s+check\s*\(\s*user_id\s*=\s*auth\.uid\s*\(\s*\)\s*\)/i);
});

test('analytics events migration stores privacy-minimal product events', () => {
  assert.match(analyticsEventsMigration, /create\s+table\s+if\s+not\s+exists\s+analytics_events/i);
  assert.match(analyticsEventsMigration, /user_id\s+uuid\s+references\s+auth\.users\s*\(\s*id\s*\)\s+on\s+delete\s+set\s+null/i);
  assert.match(analyticsEventsMigration, /event_name\s+text\s+not\s+null\s+check\s*\(\s*event_name\s+~\s+'\^\[a-z0-9_\.\]\{3,80\}\$'/i);
  assert.match(analyticsEventsMigration, /properties\s+jsonb\s+not\s+null\s+default\s+'\{\}'::jsonb/i);
  assert.match(analyticsEventsMigration, /occurred_at\s+timestamptz\s+not\s+null\s+default\s+now\s*\(\s*\)/i);
});

test('analytics events migration blocks client reads and allows scoped writes', () => {
  assert.match(analyticsEventsMigration, /alter\s+table\s+analytics_events\s+enable\s+row\s+level\s+security/i);
  assert.match(analyticsEventsMigration, /create\s+policy\s+"insert own analytics events"[\s\S]*with\s+check\s*\([\s\S]*user_id\s+is\s+null[\s\S]*or\s+user_id\s*=\s*auth\.uid\s*\(\s*\)/i);
  assert.match(analyticsEventsMigration, /revoke\s+all\s+on\s+analytics_events\s+from\s+anon,\s*authenticated/i);
  assert.doesNotMatch(analyticsEventsMigration, /for\s+select\s+to\s+anon/i);
  assert.doesNotMatch(analyticsEventsMigration, /for\s+select\s+to\s+authenticated/i);
});

test('moderation queue migration exposes a merged curator queue RPC', () => {
  assert.match(moderationQueueMigration, /create\s+or\s+replace\s+function\s+get_moderation_queue\s*\(\s*p_limit\s+integer\s+default\s+50\s*\)/i);
  assert.match(moderationQueueMigration, /returns\s+table\s*\([\s\S]*report_kind\s+text[\s\S]*target_type\s+text[\s\S]*report_id\s+uuid[\s\S]*created_at\s+timestamptz/i);
  assert.match(moderationQueueMigration, /from\s+comment_reports/i);
  assert.match(moderationQueueMigration, /from\s+content_reports/i);
  assert.match(moderationQueueMigration, /resolved\s*=\s*false/i);
  assert.match(moderationQueueMigration, /status\s+in\s*\(\s*'open'\s*,\s*'reviewing'\s*\)/i);
  assert.match(moderationQueueMigration, /order\s+by\s+created_at\s+desc/i);
});

test('moderation queue migration restricts RPC execution to curators', () => {
  assert.match(moderationQueueMigration, /if\s+not\s+is_curator\s*\(\s*\)\s+then[\s\S]*raise\s+exception\s+'not a curator'/i);
  assert.match(moderationQueueMigration, /revoke\s+all\s+on\s+function\s+get_moderation_queue\s*\(\s*integer\s*\)\s+from\s+public/i);
  assert.match(moderationQueueMigration, /grant\s+execute\s+on\s+function\s+get_moderation_queue\s*\(\s*integer\s*\)\s+to\s+authenticated/i);
});

test('moderation audit migration logs content report status changes', () => {
  assert.match(moderationAuditMigration, /create\s+or\s+replace\s+function\s+audit_content_report_status_change\s*\(\s*\)/i);
  assert.match(moderationAuditMigration, /if\s+old\.status\s+is\s+distinct\s+from\s+new\.status/i);
  assert.match(moderationAuditMigration, /perform\s+log_admin_audit_event\s*\([\s\S]*'content_report_status_change'/i);
  assert.match(moderationAuditMigration, /drop\s+trigger\s+if\s+exists\s+content_reports_audit_status_change\s+on\s+content_reports/i);
  assert.match(moderationAuditMigration, /create\s+trigger\s+content_reports_audit_status_change[\s\S]*after\s+update\s+on\s+content_reports/i);
});

test('moderation audit migration logs comment report resolution changes', () => {
  assert.match(moderationAuditMigration, /create\s+or\s+replace\s+function\s+audit_comment_report_resolution_change\s*\(\s*\)/i);
  assert.match(moderationAuditMigration, /if\s+old\.resolved\s+is\s+distinct\s+from\s+new\.resolved/i);
  assert.match(moderationAuditMigration, /perform\s+log_admin_audit_event\s*\([\s\S]*'comment_report_resolution_change'/i);
  assert.match(moderationAuditMigration, /drop\s+trigger\s+if\s+exists\s+comment_reports_audit_resolution_change\s+on\s+comment_reports/i);
  assert.match(moderationAuditMigration, /create\s+trigger\s+comment_reports_audit_resolution_change[\s\S]*after\s+update\s+on\s+comment_reports/i);
});


test('social repost replies migration creates scoped replies table', () => {
  assert.match(socialRepostRepliesMigration, /create\s+table\s+if\s+not\s+exists\s+social_repost_replies/i);
  assert.match(socialRepostRepliesMigration, /repost_id\s+uuid\s+not\s+null\s+references\s+social_reposts\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i);
  assert.match(socialRepostRepliesMigration, /user_id\s+uuid\s+not\s+null\s+default\s+auth\.uid\s*\(\s*\)\s+references\s+auth\.users/i);
  assert.match(socialRepostRepliesMigration, /body\s+text\s+not\s+null\s+check\s*\(\s*char_length\s*\(\s*body\s*\)\s+between\s+1\s+and\s+280\s*\)/i);
  assert.match(socialRepostRepliesMigration, /status\s+comment_status\s+not\s+null\s+default\s+'visible'/i);
  assert.match(socialRepostRepliesMigration, /alter\s+table\s+social_repost_replies\s+enable\s+row\s+level\s+security/i);
});

test('social repost replies migration mirrors visible-not-blocked RLS and own writes', () => {
  assert.match(socialRepostRepliesMigration, /drop\s+policy\s+if\s+exists\s+"read visible repost replies"\s+on\s+social_repost_replies/i);
  assert.match(socialRepostRepliesMigration, /drop\s+policy\s+if\s+exists\s+"insert own repost reply"\s+on\s+social_repost_replies/i);
  assert.match(socialRepostRepliesMigration, /drop\s+policy\s+if\s+exists\s+"delete own repost reply"\s+on\s+social_repost_replies/i);
  assert.match(socialRepostRepliesMigration, /create\s+policy\s+"read visible repost replies"\s+on\s+social_repost_replies\s+for\s+select\s+to\s+anon,\s*authenticated/i);
  assert.match(socialRepostRepliesMigration, /status\s*=\s*'visible'[\s\S]*user_id\s+not\s+in\s*\(\s*select\s+blocked_id\s+from\s+blocks\s+where\s+blocker_id\s*=\s*auth\.uid\s*\(\s*\)\s*\)/i);
  assert.match(socialRepostRepliesMigration, /create\s+policy\s+"insert own repost reply"[\s\S]*with\s+check\s*\(\s*user_id\s*=\s*auth\.uid\s*\(\s*\)\s*\)/i);
  assert.match(socialRepostRepliesMigration, /create\s+policy\s+"delete own repost reply"[\s\S]*using\s*\(\s*user_id\s*=\s*auth\.uid\s*\(\s*\)\s*\)/i);
});

test('social repost replies migration denormalizes reply_count and exposes it in feed', () => {
  assert.match(socialRepostRepliesMigration, /alter\s+table\s+social_reposts[\s\S]*add\s+column\s+if\s+not\s+exists\s+reply_count\s+integer\s+not\s+null\s+default\s+0/i);
  assert.match(socialRepostRepliesMigration, /create\s+or\s+replace\s+function\s+bump_social_repost_reply_count\s*\(/i);
  assert.match(socialRepostRepliesMigration, /after\s+insert\s+on\s+social_repost_replies/i);
  assert.match(socialRepostRepliesMigration, /after\s+delete\s+on\s+social_repost_replies/i);
  assert.match(socialRepostRepliesMigration, /create\s+or\s+replace\s+view\s+social_repost_feed\s+as[\s\S]*sr\.reply_count/i);
});

test('social repost replies migration appends reply_count to existing feed view columns', () => {
  assert.match(
    socialRepostRepliesMigration,
    /create\s+or\s+replace\s+view\s+social_repost_feed\s+as[\s\S]*sr\.created_at,\s*r\.summary\s+as\s+rumor_summary,\s*r\.status\s+as\s+rumor_status,\s*p\.handle,\s*sr\.reply_count[\s\S]*from\s+social_reposts/i,
  );
});

test('social repost replies migration rate-limits reply inserts', () => {
  assert.match(socialRepostRepliesMigration, /create\s+or\s+replace\s+function\s+rate_limit_social_repost_reply_insert\s*\(\s*\)/i);
  assert.match(socialRepostRepliesMigration, /perform\s+check_rate_limit\s*\(\s*'social_repost_replies'\s*,\s*interval\s+'1 minute'\s*,\s*6\s*\)/i);
  assert.match(socialRepostRepliesMigration, /create\s+trigger\s+social_repost_replies_rate_limit\s+before\s+insert\s+on\s+social_repost_replies/i);
});

test('comment guideline guard migration requires accepted guidelines for comment inserts', () => {
  assert.match(commentGuidelineMigration, /drop\s+policy\s+if\s+exists\s+"insert own comment"\s+on\s+comments/i);
  assert.match(commentGuidelineMigration, /create\s+policy\s+"insert own comment"\s+on\s+comments\s+for\s+insert\s+to\s+authenticated/i);
  assert.match(commentGuidelineMigration, /with\s+check\s*\([\s\S]*user_id\s*=\s*auth\.uid\s*\(\s*\)[\s\S]*exists\s*\([\s\S]*from\s+profiles\s+p[\s\S]*p\.id\s*=\s*auth\.uid\s*\(\s*\)[\s\S]*p\.accepted_guidelines\s*=\s*true/i);
});

function readHandleValidationMigration() {
  const migrationUrl = new URL('../supabase/migrations/0030_profile_handle_validation.sql', import.meta.url);
  assert.equal(existsSync(migrationUrl), true, 'expected migration 0030_profile_handle_validation.sql to exist');
  return readFileSync(migrationUrl, 'utf8');
}

function readRumorCategoriesMigration() {
  const migrationUrl = new URL('../supabase/migrations/0031_rumor_categories.sql', import.meta.url);
  assert.equal(existsSync(migrationUrl), true, 'expected migration 0031_rumor_categories.sql to exist');
  return readFileSync(migrationUrl, 'utf8');
}

function readRumorCommentCountsMigration() {
  const migrationUrl = new URL('../supabase/migrations/0032_rumor_comment_counts.sql', import.meta.url);
  assert.equal(existsSync(migrationUrl), true, 'expected migration 0032_rumor_comment_counts.sql to exist');
  return readFileSync(migrationUrl, 'utf8');
}

function readDeleteAccountRepairMigration() {
  const migrationUrl = new URL('../supabase/migrations/0035_delete_account_social_cleanup.sql', import.meta.url);
  assert.equal(existsSync(migrationUrl), true, 'expected migration 0035_delete_account_social_cleanup.sql to exist');
  return readFileSync(migrationUrl, 'utf8');
}

test('profile handle validation migration enforces bounded safe handles in set_handle', () => {
  const handleValidationMigration = readHandleValidationMigration();

  assert.match(handleValidationMigration, /create\s+or\s+replace\s+function\s+set_handle\s*\(\s*p_handle\s+text\s*\)/i);
  assert.match(handleValidationMigration, /v_handle\s+text\s*:=\s*lower\s*\(\s*trim\s*\(\s*p_handle\s*\)\s*\)/i);
  assert.match(handleValidationMigration, /v_handle\s*!~\s*'\^\[a-z0-9_\]\{3,20\}\$'/i);
  assert.match(handleValidationMigration, /raise\s+exception\s+'invalid handle'/i);
});

test('profile handle validation migration rejects reserved platform handles and preserves authenticated grant', () => {
  const handleValidationMigration = readHandleValidationMigration();

  assert.match(handleValidationMigration, /v_handle\s+in\s*\([\s\S]*'admin'[\s\S]*'fofoca'[\s\S]*'suporte'[\s\S]*'moderador'[\s\S]*'curador'/i);
  assert.match(handleValidationMigration, /grant\s+execute\s+on\s+function\s+set_handle\s*\(\s*text\s*\)\s+to\s+authenticated/i);
});

test('hybrid resolution migration defaults to evidence-first with a resolve-by window', () => {
  assert.match(hybridResolutionMigration, /alter\s+table\s+rumors[\s\S]*alter\s+column\s+resolution_policy\s+set\s+default\s+'evidence'/i);
  assert.match(hybridResolutionMigration, /alter\s+column\s+prediction_deadline\s+set\s+default\s*\(\s*now\s*\(\s*\)\s*\+\s*interval\s+'7 days'\s*\)/i);
  assert.match(hybridResolutionMigration, /alter\s+type\s+rumor_status\s+add\s+value\s+if\s+not\s+exists\s+'void'/i);
  // Must NOT flatten every rumor to deadline/CAP the way the old draft did.
  assert.doesNotMatch(hybridResolutionMigration, /set\s+default\s+'deadline'/i);
});

test('hybrid resolution migration adds a VOID (push) path that never touches scores', () => {
  assert.match(hybridResolutionMigration, /create\s+or\s+replace\s+function\s+void_rumor\s*\(/i);
  assert.match(hybridResolutionMigration, /points_awarded\s*=\s*0/i);
  assert.match(hybridResolutionMigration, /is_correct\s*=\s*null/i);
  // VOID must not award points or move accuracy — no profiles write in this migration.
  assert.doesNotMatch(hybridResolutionMigration, /update\s+profiles/i);
});

test('hybrid sweeper CAPs deadline-policy rumors but VOIDs evidence-policy rumors', () => {
  assert.match(hybridResolutionMigration, /create\s+or\s+replace\s+function\s+resolve_expired_prediction_deadlines\s*\(/i);
  assert.match(hybridResolutionMigration, /if\s+r\.resolution_policy\s*=\s*'deadline'\s+then/i);
  assert.match(hybridResolutionMigration, /perform\s+resolve_rumor\s*\(\s*r\.id\s*,\s*false\s*\)/i);
  assert.match(hybridResolutionMigration, /perform\s+void_rumor\s*\(\s*r\.id/i);
});

test('rumor category migration adds bounded safe display labels', () => {
  const rumorCategoriesMigration = readRumorCategoriesMigration();

  assert.match(rumorCategoriesMigration, /alter\s+table\s+rumors[\s\S]*add\s+column\s+if\s+not\s+exists\s+category\s+text/i);
  assert.match(rumorCategoriesMigration, /add\s+constraint\s+rumors_category_safe_text/i);
  assert.match(rumorCategoriesMigration, /char_length\s*\(\s*btrim\s*\(\s*category\s*\)\s*\)\s+between\s+2\s+and\s+32/i);
  assert.match(rumorCategoriesMigration, /category\s+!~\s+'\[<>\{\}\]'/i);
  assert.match(rumorCategoriesMigration, /category\s+!~\*\s+'javascript:'/i);
  const categoryIndex = rumorCategoriesMigration.match(/create\s+index\s+if\s+not\s+exists\s+rumors_category_published_idx[\s\S]*?;/i)?.[0] ?? '';
  assert.doesNotMatch(categoryIndex, /now\s*\(\s*\)/i);
});

test('rumor category migration exposes category through feed and search RPCs', () => {
  const rumorCategoriesMigration = readRumorCategoriesMigration();

  assert.match(rumorCategoriesMigration, /create\s+or\s+replace\s+function\s+get_feed\s*\(\s*p_limit\s+integer\s+default\s+30\s*\)[\s\S]*category\s+text/i);
  assert.match(rumorCategoriesMigration, /drop\s+function\s+if\s+exists\s+get_feed\s*\(\s*integer\s*\)/i);
  assert.match(rumorCategoriesMigration, /nullif\s*\(\s*btrim\s*\(\s*r\.category\s*\)\s*,\s*''\s*\)\s+as\s+category/i);
  assert.match(rumorCategoriesMigration, /create\s+or\s+replace\s+function\s+search_rumors\s*\(\s*p_query\s+text\s*,\s*p_limit\s+integer\s+default\s+50\s*\)[\s\S]*category\s+text/i);
  assert.match(rumorCategoriesMigration, /drop\s+function\s+if\s+exists\s+search_rumors\s*\(\s*text\s*,\s*integer\s*\)/i);
  assert.match(rumorCategoriesMigration, /lower\s*\(\s*unaccent\s*\(\s*coalesce\s*\(\s*r\.category\s*,\s*''\s*\)\s*\)\s*\)\s+ilike/i);
  assert.match(rumorCategoriesMigration, /grant\s+execute\s+on\s+function\s+get_feed\s*\(\s*integer\s*\)\s+to\s+anon,\s*authenticated/i);
  assert.match(rumorCategoriesMigration, /grant\s+execute\s+on\s+function\s+search_rumors\s*\(\s*text\s*,\s*integer\s*\)\s+to\s+anon,\s*authenticated/i);
});

test('rumor comment count migration denormalizes visible comment counts onto rumors', () => {
  const commentCountsMigration = readRumorCommentCountsMigration();

  assert.match(commentCountsMigration, /alter\s+table\s+rumors[\s\S]*add\s+column\s+if\s+not\s+exists\s+comment_count\s+integer\s+not\s+null\s+default\s+0/i);
  assert.match(commentCountsMigration, /add\s+constraint\s+rumors_comment_count_nonnegative\s+check\s*\(\s*comment_count\s*>=\s*0\s*\)/i);
  assert.match(commentCountsMigration, /from\s+comments[\s\S]*where\s+status\s*=\s*'visible'[\s\S]*group\s+by\s+rumor_id/i);
  assert.match(commentCountsMigration, /create\s+index\s+if\s+not\s+exists\s+rumors_comment_count_published_idx/i);
});

test('rumor comment count migration keeps counts current on comment changes', () => {
  const commentCountsMigration = readRumorCommentCountsMigration();

  assert.match(commentCountsMigration, /create\s+or\s+replace\s+function\s+refresh_rumor_comment_count\s*\(\s*p_rumor_id\s+uuid\s*\)/i);
  assert.match(commentCountsMigration, /revoke\s+all\s+on\s+function\s+refresh_rumor_comment_count\s*\(\s*uuid\s*\)\s+from\s+public/i);
  assert.match(commentCountsMigration, /revoke\s+all\s+on\s+function\s+refresh_rumor_comment_count\s*\(\s*uuid\s*\)\s+from\s+anon,\s*authenticated/i);
  assert.match(commentCountsMigration, /where\s+c\.rumor_id\s*=\s*p_rumor_id[\s\S]*and\s+c\.status\s*=\s*'visible'/i);
  assert.match(commentCountsMigration, /revoke\s+all\s+on\s+function\s+bump_rumor_comment_count\s*\(\s*\)\s+from\s+public/i);
  assert.match(commentCountsMigration, /revoke\s+all\s+on\s+function\s+bump_rumor_comment_count\s*\(\s*\)\s+from\s+anon,\s*authenticated/i);
  assert.match(commentCountsMigration, /after\s+insert\s+on\s+comments/i);
  assert.match(commentCountsMigration, /after\s+update\s+of\s+status\s*,\s*rumor_id\s+on\s+comments/i);
  assert.match(commentCountsMigration, /after\s+delete\s+on\s+comments/i);
});

test('rumor comment count migration exposes comment_count through feed/search RPCs', () => {
  const commentCountsMigration = readRumorCommentCountsMigration();

  assert.match(commentCountsMigration, /drop\s+function\s+if\s+exists\s+get_feed\s*\(\s*integer\s*\)/i);
  assert.match(commentCountsMigration, /create\s+or\s+replace\s+function\s+get_feed\s*\(\s*p_limit\s+integer\s+default\s+30\s*\)[\s\S]*comment_count\s+integer/i);
  assert.match(commentCountsMigration, /r\.comment_count/i);
  assert.match(commentCountsMigration, /drop\s+function\s+if\s+exists\s+search_rumors\s*\(\s*text\s*,\s*integer\s*\)/i);
  assert.match(commentCountsMigration, /create\s+or\s+replace\s+function\s+search_rumors\s*\(\s*p_query\s+text\s*,\s*p_limit\s+integer\s+default\s+50\s*\)[\s\S]*comment_count\s+integer/i);
  assert.match(commentCountsMigration, /grant\s+execute\s+on\s+function\s+get_feed\s*\(\s*integer\s*\)\s+to\s+anon,\s*authenticated/i);
  assert.match(commentCountsMigration, /grant\s+execute\s+on\s+function\s+search_rumors\s*\(\s*text\s*,\s*integer\s*\)\s+to\s+anon,\s*authenticated/i);
});

test('delete account repair clears post-v1 user-owned social rows before deleting auth user', () => {
  const migration = readDeleteAccountRepairMigration();

  assert.match(migration, /create\s+or\s+replace\s+function\s+delete_my_account\s*\(\s*\)/i);
  for (const table of ['social_repost_replies', 'social_repost_reactions', 'social_reposts', 'rumor_reactions', 'content_reports', 'push_devices', 'notification_preferences', 'user_rate_limits']) {
    assert.match(migration, new RegExp(`delete\\s+from\\s+${table}\\b`, 'i'), `expected cleanup for ${table}`);
  }
  assert.match(migration, /delete\s+from\s+auth\.users\s+where\s+id\s*=\s*v/i);
});

test('delete account repair keeps authenticated-only execute and revokes public access', () => {
  const migration = readDeleteAccountRepairMigration();

  assert.match(migration, /security\s+definer\s+set\s+search_path\s*=\s*public/i);
  assert.match(migration, /revoke\s+all\s+on\s+function\s+delete_my_account\s*\(\s*\)\s+from\s+public/i);
  assert.match(migration, /revoke\s+all\s+on\s+function\s+delete_my_account\s*\(\s*\)\s+from\s+anon/i);
  assert.match(migration, /grant\s+execute\s+on\s+function\s+delete_my_account\s*\(\s*\)\s+to\s+authenticated/i);
});
