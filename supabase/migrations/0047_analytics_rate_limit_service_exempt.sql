-- 0047_analytics_rate_limit_service_exempt.sql
-- Corrective, additive: exempt the trusted service_role from the analytics_events
-- INSERT rate limit.
--
-- Why: user rate limits exist to throttle abusive END USERS. log_economy_analytics
-- writes system/market events, and is reached by service_role backend paths
-- (e.g. the scheduler publishing a due market, or publish_approved_market which
-- elevates to service_role to call service_approve_fixed_market_probabilities).
-- In those paths auth.uid() is null, so check_rate_limit('analytics_events', ...)
-- raised 'not authenticated' and aborted an otherwise-valid publication. Real
-- interactive users still carry the 'authenticated' role and remain rate-limited.

create or replace function rate_limit_analytics_events_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- trusted backend/service context is not a user to rate-limit
  if coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.role()) = 'service_role' then
    return new;
  end if;
  perform check_rate_limit('analytics_events', interval '1 minute', 60);
  return new;
end;
$$;
