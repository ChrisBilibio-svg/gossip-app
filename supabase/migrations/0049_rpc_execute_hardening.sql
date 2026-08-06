-- 0049_rpc_execute_hardening.sql — explicitly revoke PUBLIC execute on sensitive RPCs
--
-- CODE-READY / HUMAN-GATED:
-- 1. Apply after prior function migrations have been applied.
-- 2. This does not change table shape or business logic; it narrows function privileges.
-- 3. Supabase/Postgres can leave EXECUTE granted to PUBLIC by default on newly-created functions,
--    even when the function body checks auth.uid(). Revoke PUBLIC/anon explicitly for sensitive RPCs.

-- Auth/profile/account writes
revoke all on function set_handle(text) from public, anon;
grant execute on function set_handle(text) to authenticated;

revoke all on function set_avatar(text) from public, anon;
grant execute on function set_avatar(text) to authenticated;

revoke all on function set_profile_location(text, text) from public, anon;
grant execute on function set_profile_location(text, text) to authenticated;

revoke all on function accept_guidelines() from public, anon;
grant execute on function accept_guidelines() to authenticated;

revoke all on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;

-- Prediction/economy writes and private reads
revoke all on function place_bet(uuid, bet_choice) from public, anon;
grant execute on function place_bet(uuid, bet_choice) to authenticated;

revoke all on function request_fixed_prediction_quote(uuid, bet_choice) from public, anon;
grant execute on function request_fixed_prediction_quote(uuid, bet_choice) to authenticated;

revoke all on function place_fixed_prediction(uuid, bet_choice, integer, integer, text) from public, anon;
grant execute on function place_fixed_prediction(uuid, bet_choice, integer, integer, text) to authenticated;

revoke all on function place_fixed_prediction(uuid, bet_choice, integer, integer, text, uuid) from public, anon;
grant execute on function place_fixed_prediction(uuid, bet_choice, integer, integer, text, uuid) to authenticated;

revoke all on function get_coin_economy_state() from public, anon;
grant execute on function get_coin_economy_state() to authenticated;

revoke all on function get_wallet_history(integer, timestamptz) from public, anon;
grant execute on function get_wallet_history(integer, timestamptz) to authenticated;

revoke all on function grant_starter_coins() from public, anon;
grant execute on function grant_starter_coins() to authenticated;

revoke all on function get_fixed_market_quote(uuid) from public, anon;
grant execute on function get_fixed_market_quote(uuid) to authenticated;

revoke all on function get_my_fixed_positions(integer) from public, anon;
grant execute on function get_my_fixed_positions(integer) to authenticated;

-- Curator/moderation/group RPCs
revoke all on function resolve_rumor(uuid, boolean) from public, anon;
grant execute on function resolve_rumor(uuid, boolean) to authenticated;

revoke all on function resolve_rumor_with_evidence(uuid, boolean) from public, anon;
grant execute on function resolve_rumor_with_evidence(uuid, boolean) to authenticated;

-- NOTE: the 6-arg publish_approved_market was dropped in 0048 and replaced by the
-- 7-arg form below (per-market betting window). Only the current signature is hardened.
revoke all on function publish_approved_market(uuid, numeric, numeric, timestamptz, text, text, timestamptz) from public, anon;
grant execute on function publish_approved_market(uuid, numeric, numeric, timestamptz, text, text, timestamptz) to authenticated, service_role;

revoke all on function record_market_decision(uuid, text, numeric, numeric, timestamptz, jsonb) from public, anon;
grant execute on function record_market_decision(uuid, text, numeric, numeric, timestamptz, jsonb) to authenticated;

revoke all on function get_moderation_queue(integer) from public, anon;
grant execute on function get_moderation_queue(integer) to authenticated;

revoke all on function create_group(text, timestamptz, text) from public, anon;
grant execute on function create_group(text, timestamptz, text) to authenticated;

revoke all on function join_group(text) from public, anon;
grant execute on function join_group(text) to authenticated;

revoke all on function leave_group(uuid) from public, anon;
grant execute on function leave_group(uuid) to authenticated;

revoke all on function get_my_groups() from public, anon;
grant execute on function get_my_groups() to authenticated;

revoke all on function rename_group(uuid, text, text) from public, anon;
grant execute on function rename_group(uuid, text, text) to authenticated;

revoke all on function remove_group_member(uuid, uuid) from public, anon;
grant execute on function remove_group_member(uuid, uuid) to authenticated;

revoke all on function delete_group(uuid) from public, anon;
grant execute on function delete_group(uuid) to authenticated;

revoke all on function regenerate_group_invite(uuid) from public, anon;
grant execute on function regenerate_group_invite(uuid) to authenticated;
