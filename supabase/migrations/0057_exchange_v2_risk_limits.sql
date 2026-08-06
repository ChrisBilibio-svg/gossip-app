-- 0057_exchange_v2_risk_limits.sql — exchange-v2 risk limits and market controls
--
-- CODE-READY / HUMAN-GATED:
-- - Chris applies migrations manually; Hermes must not apply this file.
-- - Production trading remains disabled. This migration does not update the
--   production exchange_feature_gates row and does not enable any gate.
-- - Limits are server-side guardrails only; coins remain closed-loop with no
--   cash value, withdrawal, redemption, prizes, or crypto conversion.
-- - Legacy fixed-odds semantics remain isolated from exchange_v2.
--
-- M7:
-- - Adds per-environment exchange risk limits.
-- - Enforces per-user open-order, position/exposure, order-notional, and order
--   rate limits before accepting a new v2 order.
-- - Adds append-only exchange_risk_events for allowed/blocked/pause/resume
--   risk decisions.
-- - Adds curator/service-gated market pause/resume controls.

create table if not exists exchange_risk_limits (
  environment text primary key check (environment in ('development', 'preview', 'production')),
  enabled boolean not null default true,
  max_open_orders_per_user_global integer not null default 100 check (max_open_orders_per_user_global > 0),
  max_open_orders_per_user_market integer not null default 20 check (max_open_orders_per_user_market > 0),
  max_position_quantity_per_market_outcome numeric(24,6) not null default 1000.000000 check (max_position_quantity_per_market_outcome > 0),
  max_gross_notional_per_user_market numeric(24,6) not null default 1000.000000 check (max_gross_notional_per_user_market > 0),
  max_order_notional numeric(24,6) not null default 100.000000 check (max_order_notional > 0),
  order_rate_limit_count integer not null default 30 check (order_rate_limit_count > 0),
  order_rate_limit_window_seconds integer not null default 60 check (order_rate_limit_window_seconds > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into exchange_risk_limits (environment) values ('development'), ('preview'), ('production')
on conflict (environment) do nothing;

create table if not exists exchange_risk_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  market_id uuid references exchange_markets (market_id) on delete cascade,
  outcome exchange_outcome,
  order_id uuid references exchange_orders (id) on delete set null,
  event_type text not null check (event_type in (
    'order_allowed',
    'order_blocked',
    'rate_limit_exceeded',
    'open_order_limit_exceeded',
    'position_limit_exceeded',
    'exposure_limit_exceeded',
    'order_notional_limit_exceeded',
    'market_paused',
    'market_resumed'
  )),
  severity text not null default 'info' check (severity in ('info', 'warn', 'block')),
  decision text not null check (decision in ('allowed', 'blocked', 'paused', 'resumed')),
  reason text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

-- 0050 already created exchange_risk_events with a narrower shape. Because the
-- create-if-not-exists above is a no-op on migrated databases, explicitly add
-- every M7 column/constraint that exchange_log_risk_event_v2 inserts into.
alter table exchange_risk_events
  add column if not exists outcome exchange_outcome,
  add column if not exists order_id uuid references exchange_orders (id) on delete set null,
  add column if not exists decision text,
  add column if not exists reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.exchange_risk_events'::regclass
      and conname = 'exchange_risk_events_m7_event_type_check'
  ) then
    alter table exchange_risk_events
      add constraint exchange_risk_events_m7_event_type_check check (event_type in (
        'order_allowed',
        'order_blocked',
        'rate_limit_exceeded',
        'open_order_limit_exceeded',
        'position_limit_exceeded',
        'exposure_limit_exceeded',
        'order_notional_limit_exceeded',
        'market_paused',
        'market_resumed'
      )) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.exchange_risk_events'::regclass
      and conname = 'exchange_risk_events_m7_decision_check'
  ) then
    alter table exchange_risk_events
      add constraint exchange_risk_events_m7_decision_check check (decision is null or decision in ('allowed', 'blocked', 'paused', 'resumed')) not valid;
  end if;
end $$;

create index if not exists exchange_risk_events_user_created_idx on exchange_risk_events (user_id, created_at desc);
create index if not exists exchange_risk_events_market_created_idx on exchange_risk_events (market_id, created_at desc);
create index if not exists exchange_risk_events_type_created_idx on exchange_risk_events (event_type, created_at desc);

create table if not exists exchange_market_controls (
  market_id uuid primary key references exchange_markets (market_id) on delete cascade,
  paused boolean not null default false,
  paused_at timestamptz,
  paused_by uuid references auth.users (id) on delete set null,
  pause_reason text,
  resumed_at timestamptz,
  resumed_by uuid references auth.users (id) on delete set null,
  resume_reason text,
  updated_at timestamptz not null default now(),
  check ((paused and paused_at is not null and pause_reason is not null) or (not paused))
);

create or replace function exchange_risk_limits_for_environment_v2(p_environment text)
returns exchange_risk_limits
language sql
stable
as $$
  select *
  from exchange_risk_limits
  where environment = coalesce(nullif(p_environment, ''), 'production')
$$;

create or replace function exchange_log_risk_event_v2(
  p_user_id uuid,
  p_market_id uuid,
  p_outcome exchange_outcome,
  p_order_id uuid,
  p_event_type text,
  p_severity text,
  p_decision text,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns exchange_risk_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event exchange_risk_events;
begin
  insert into exchange_risk_events (
    user_id,
    market_id,
    outcome,
    order_id,
    event_type,
    severity,
    decision,
    reason,
    metadata
  ) values (
    p_user_id,
    p_market_id,
    p_outcome,
    p_order_id,
    p_event_type,
    p_severity,
    p_decision,
    p_reason,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'engineVersion', 'exchange_v2',
      'legacyFixedOddsTouched', false,
      'coinsClosedLoop', true,
      'productionGateTouched', false
    )
  ) returning * into v_event;

  return v_event;
end;
$$;

create or replace function exchange_order_notional_v2(p_quantity numeric, p_limit_price numeric)
returns numeric
language sql
immutable
as $$
  select round(coalesce(p_quantity, 0) * coalesce(p_limit_price, 0), 6)
$$;

create or replace function exchange_user_open_order_count_v2(
  p_user_id uuid,
  p_market_id uuid default null
)
returns integer
language sql
stable
as $$
  select count(*)::integer
  from exchange_orders o
  where o.user_id = p_user_id
    and o.status in ('open','partially_filled')
    and (p_market_id is null or o.market_id = p_market_id)
$$;

create or replace function exchange_user_market_gross_notional_v2(
  p_user_id uuid,
  p_market_id uuid
)
returns numeric
language sql
stable
as $$
  select round(coalesce((
    select sum(p.quantity * greatest(p.average_entry_price, 0))
    from exchange_positions p
    where p.user_id = p_user_id
      and p.market_id = p_market_id
      and p.settlement_id is null
  ), 0) + coalesce((
    select sum(exchange_order_notional_v2(o.remaining_quantity, o.limit_price))
    from exchange_orders o
    where o.user_id = p_user_id
      and o.market_id = p_market_id
      and o.action = 'buy'
      and o.status in ('open','partially_filled')
  ), 0), 6)
$$;

create or replace function exchange_recent_order_count_v2(
  p_user_id uuid,
  p_window_seconds integer
)
returns integer
language sql
stable
as $$
  select count(*)::integer
  from exchange_orders o
  where o.user_id = p_user_id
    and o.created_at >= now() - make_interval(secs => greatest(coalesce(p_window_seconds, 60), 1))
$$;

create or replace function exchange_check_order_risk_limits_v2(
  p_user_id uuid,
  p_market_id uuid,
  p_outcome exchange_outcome,
  p_action exchange_order_action,
  p_quantity numeric,
  p_limit_price numeric,
  p_environment text default 'production'
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_limits exchange_risk_limits;
  v_order_notional numeric := exchange_order_notional_v2(p_quantity, p_limit_price);
  v_global_open integer;
  v_market_open integer;
  v_recent integer;
  v_position_quantity numeric;
  v_pending_buy_quantity numeric;
  v_projected_position numeric;
  v_projected_gross_notional numeric;
begin
  select * into v_limits from exchange_risk_limits_for_environment_v2(p_environment);
  if not found or not v_limits.enabled then
    return jsonb_build_object('allowed', true, 'reason', 'risk limits disabled for environment');
  end if;

  v_global_open := exchange_user_open_order_count_v2(p_user_id, null);
  if v_global_open >= v_limits.max_open_orders_per_user_global then
    return jsonb_build_object('allowed', false, 'eventType', 'open_order_limit_exceeded', 'reason', 'global open order limit exceeded', 'current', v_global_open, 'limit', v_limits.max_open_orders_per_user_global);
  end if;

  v_market_open := exchange_user_open_order_count_v2(p_user_id, p_market_id);
  if v_market_open >= v_limits.max_open_orders_per_user_market then
    return jsonb_build_object('allowed', false, 'eventType', 'open_order_limit_exceeded', 'reason', 'market open order limit exceeded', 'current', v_market_open, 'limit', v_limits.max_open_orders_per_user_market);
  end if;

  v_recent := exchange_recent_order_count_v2(p_user_id, v_limits.order_rate_limit_window_seconds);
  if v_recent >= v_limits.order_rate_limit_count then
    return jsonb_build_object('allowed', false, 'eventType', 'rate_limit_exceeded', 'reason', 'order rate limit exceeded', 'current', v_recent, 'limit', v_limits.order_rate_limit_count, 'windowSeconds', v_limits.order_rate_limit_window_seconds);
  end if;

  if v_order_notional > v_limits.max_order_notional then
    return jsonb_build_object('allowed', false, 'eventType', 'order_notional_limit_exceeded', 'reason', 'order notional limit exceeded', 'current', v_order_notional, 'limit', v_limits.max_order_notional);
  end if;

  if p_action = 'buy' then
    select coalesce(p.quantity, 0) into v_position_quantity
    from exchange_positions p
    where p.user_id = p_user_id
      and p.market_id = p_market_id
      and p.outcome = p_outcome
      and p.settlement_id is null;
    v_position_quantity := coalesce(v_position_quantity, 0);

    select coalesce(sum(o.remaining_quantity), 0) into v_pending_buy_quantity
    from exchange_orders o
    where o.user_id = p_user_id
      and o.market_id = p_market_id
      and o.outcome = p_outcome
      and o.action = 'buy'
      and o.status in ('open','partially_filled');

    v_projected_position := round(v_position_quantity + v_pending_buy_quantity + p_quantity, 6);
    if v_projected_position > v_limits.max_position_quantity_per_market_outcome then
      return jsonb_build_object('allowed', false, 'eventType', 'position_limit_exceeded', 'reason', 'position limit exceeded', 'current', v_projected_position, 'limit', v_limits.max_position_quantity_per_market_outcome);
    end if;

    v_projected_gross_notional := round(exchange_user_market_gross_notional_v2(p_user_id, p_market_id) + v_order_notional, 6);
    if v_projected_gross_notional > v_limits.max_gross_notional_per_user_market then
      return jsonb_build_object('allowed', false, 'eventType', 'exposure_limit_exceeded', 'reason', 'market exposure limit exceeded', 'current', v_projected_gross_notional, 'limit', v_limits.max_gross_notional_per_user_market);
    end if;
  end if;

  return jsonb_build_object(
    'allowed', true,
    'eventType', 'order_allowed',
    'reason', 'risk limits passed',
    'orderNotional', v_order_notional,
    'globalOpenOrders', v_global_open,
    'marketOpenOrders', v_market_open,
    'recentOrders', v_recent
  );
end;
$$;

create or replace function exchange_reject_order_for_risk_v2(
  p_user_id uuid,
  p_market_id uuid,
  p_outcome exchange_outcome,
  p_action exchange_order_action,
  p_quantity numeric,
  p_limit_price numeric,
  p_time_in_force exchange_time_in_force,
  p_client_order_id text,
  p_quote_id uuid,
  p_accepted_worst_price numeric,
  p_expires_at timestamptz,
  p_risk_result jsonb
)
returns exchange_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order exchange_orders;
  v_event_type text := coalesce(p_risk_result->>'eventType', 'order_blocked');
  v_reason text := coalesce(p_risk_result->>'reason', 'risk limit blocked order');
begin
  insert into exchange_orders (
    user_id, market_id, outcome, action, limit_price, original_quantity,
    filled_quantity, remaining_quantity, cancelled_quantity, time_in_force,
    reduce_only, status, client_order_id, quote_id, accepted_worst_price,
    rejected_reason, expires_at
  ) values (
    p_user_id, p_market_id, p_outcome, p_action, p_limit_price, p_quantity,
    0, 0, p_quantity, p_time_in_force,
    p_action = 'sell', 'rejected', p_client_order_id, p_quote_id, p_accepted_worst_price,
    v_reason, p_expires_at
  ) returning * into v_order;

  perform exchange_log_risk_event_v2(
    p_user_id,
    p_market_id,
    p_outcome,
    v_order.id,
    v_event_type,
    'block',
    'blocked',
    v_reason,
    p_risk_result
  );

  return v_order;
end;
$$;

create or replace function pause_exchange_market_v2(
  p_market_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_market exchange_markets;
begin
  perform exchange_require_curator_or_service();
  if p_reason is null or length(trim(p_reason)) < 8 then
    raise exception 'pause reason must be specific';
  end if;

  perform pg_advisory_xact_lock(exchange_market_lock_key(p_market_id, 'true'));
  perform pg_advisory_xact_lock(exchange_market_lock_key(p_market_id, 'false'));

  select * into v_market from exchange_markets where market_id = p_market_id for update;
  if not found then raise exception 'exchange market not found'; end if;
  if v_market.state not in ('open','paused') then raise exception 'only open markets can be paused'; end if;

  insert into exchange_market_controls (market_id, paused, paused_at, paused_by, pause_reason, updated_at)
  values (p_market_id, true, now(), v_actor, trim(p_reason), now())
  on conflict (market_id) do update set
    paused = true,
    paused_at = coalesce(exchange_market_controls.paused_at, excluded.paused_at),
    paused_by = excluded.paused_by,
    pause_reason = excluded.pause_reason,
    updated_at = now();

  update exchange_markets
  set state = 'paused',
      book_version = book_version + 1,
      updated_at = now()
  where market_id = p_market_id
  returning * into v_market;

  perform exchange_log_risk_event_v2(v_actor, p_market_id, null, null, 'market_paused', 'warn', 'paused', trim(p_reason), jsonb_build_object('marketState', v_market.state));

  insert into exchange_audit_events (actor_user_id, event_type, aggregate_type, aggregate_id, aggregate_version, metadata)
  values (v_actor, 'exchange_market_paused', 'exchange_market', p_market_id, v_market.book_version, jsonb_build_object('reason', trim(p_reason), 'productionGateTouched', false));

  return exchange_market_lifecycle_response(p_market_id);
end;
$$;

create or replace function resume_exchange_market_v2(
  p_market_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_market exchange_markets;
begin
  perform exchange_require_curator_or_service();
  if p_reason is null or length(trim(p_reason)) < 8 then
    raise exception 'resume reason must be specific';
  end if;

  perform pg_advisory_xact_lock(exchange_market_lock_key(p_market_id, 'true'));
  perform pg_advisory_xact_lock(exchange_market_lock_key(p_market_id, 'false'));

  select * into v_market from exchange_markets where market_id = p_market_id for update;
  if not found then raise exception 'exchange market not found'; end if;
  if v_market.state <> 'paused' then raise exception 'only paused markets can be resumed'; end if;
  if v_market.close_at <= now() then raise exception 'closed markets cannot be resumed'; end if;

  insert into exchange_market_controls (market_id, paused, resumed_at, resumed_by, resume_reason, updated_at)
  values (p_market_id, false, now(), v_actor, trim(p_reason), now())
  on conflict (market_id) do update set
    paused = false,
    resumed_at = excluded.resumed_at,
    resumed_by = excluded.resumed_by,
    resume_reason = excluded.resume_reason,
    updated_at = now();

  update exchange_markets
  set state = 'open',
      book_version = book_version + 1,
      updated_at = now()
  where market_id = p_market_id
  returning * into v_market;

  perform exchange_log_risk_event_v2(v_actor, p_market_id, null, null, 'market_resumed', 'info', 'resumed', trim(p_reason), jsonb_build_object('marketState', v_market.state));

  insert into exchange_audit_events (actor_user_id, event_type, aggregate_type, aggregate_id, aggregate_version, metadata)
  values (v_actor, 'exchange_market_resumed', 'exchange_market', p_market_id, v_market.book_version, jsonb_build_object('reason', trim(p_reason), 'productionGateTouched', false));

  return exchange_market_lifecycle_response(p_market_id);
end;
$$;

create or replace function place_order_v2(
  p_market_id uuid,
  p_outcome exchange_outcome,
  p_action exchange_order_action,
  p_quantity numeric,
  p_limit_price numeric,
  p_time_in_force exchange_time_in_force,
  p_client_order_id text,
  p_quote_id uuid,
  p_environment text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_market exchange_markets;
  v_quote exchange_order_quotes;
  v_order exchange_orders;
  v_reservation exchange_reservations;
  v_match jsonb := '{}'::jsonb;
  v_fillable numeric := 0;
  v_cancel_qty numeric := 0;
  v_expires_at timestamptz := null;
  v_risk_result jsonb := '{}'::jsonb;
begin
  if v_user is null then raise exception 'auth required'; end if;
  if not exchange_gate_allows(p_environment, p_action) then
    raise exception 'exchange trading is disabled';
  end if;

  -- ADR lock order: market advisory lock -> market row -> reservations -> orders -> fills/ledger.
  perform pg_advisory_xact_lock(exchange_market_lock_key(p_market_id, p_outcome));

  select * into v_market from exchange_markets where market_id = p_market_id for update;
  if not found or v_market.state <> 'open' or v_market.close_at <= now() then
    raise exception 'market is not open';
  end if;

  if exists (select 1 from exchange_market_controls c where c.market_id = p_market_id and c.paused) then
    raise exception 'market is paused';
  end if;

  if p_time_in_force = 'GTD' then
    if p_expires_at is null then
      raise exception 'GTD orders require explicit expires_at';
    end if;
    if p_expires_at <= now() then
      raise exception 'GTD expires_at must be in the future';
    end if;
    if p_expires_at > v_market.close_at then
      raise exception 'GTD expires_at cannot exceed market close';
    end if;
    v_expires_at := p_expires_at;
  elsif p_expires_at is not null then
    raise exception 'expires_at is only supported for GTD orders';
  end if;

  select * into v_order
  from exchange_orders
  where user_id = v_user
    and client_order_id = p_client_order_id
  for update;

  if found then
    if v_order.market_id <> p_market_id
       or v_order.outcome <> p_outcome
       or v_order.action <> p_action
       or v_order.original_quantity <> p_quantity
       or v_order.limit_price <> p_limit_price
       or v_order.time_in_force <> p_time_in_force
       or coalesce(v_order.expires_at, '-infinity'::timestamptz) <> coalesce(v_expires_at, '-infinity'::timestamptz) then
      raise exception 'client_order_id already used with different order parameters';
    end if;

    return exchange_order_response_v2(v_order, v_market);
  end if;

  perform exchange_assert_tick(p_limit_price, v_market.tick_size, 'limit_price');
  perform exchange_assert_tick(p_quantity, v_market.quantity_step, 'quantity');
  if p_quantity < v_market.min_order_quantity then
    raise exception 'quantity below market minimum';
  end if;

  select * into v_quote from exchange_order_quotes where id = p_quote_id and user_id = v_user for update;
  if not found or v_quote.expires_at <= now() or v_quote.book_version <> v_market.book_version then
    raise exception 'quote expired or stale; requote required';
  end if;
  if v_quote.market_id <> p_market_id or v_quote.outcome <> p_outcome or v_quote.action <> p_action or v_quote.requested_limit_price <> p_limit_price or v_quote.requested_quantity <> p_quantity then
    raise exception 'quote changed; requote required';
  end if;

  v_risk_result := exchange_check_order_risk_limits_v2(v_user, p_market_id, p_outcome, p_action, p_quantity, p_limit_price, p_environment);
  if not coalesce((v_risk_result->>'allowed')::boolean, false) then
    v_order := exchange_reject_order_for_risk_v2(
      v_user,
      p_market_id,
      p_outcome,
      p_action,
      p_quantity,
      p_limit_price,
      p_time_in_force,
      p_client_order_id,
      p_quote_id,
      v_quote.worst_execution_price,
      v_expires_at,
      v_risk_result
    );
    return exchange_order_response_v2(v_order, v_market);
  end if;

  if exchange_self_cross_exists_v2(p_market_id, p_outcome, p_action, p_limit_price, v_user) then
    insert into exchange_orders (
      user_id, market_id, outcome, action, limit_price, original_quantity,
      filled_quantity, remaining_quantity, cancelled_quantity, time_in_force,
      reduce_only, status, client_order_id, quote_id, accepted_worst_price, rejected_reason, expires_at
    ) values (
      v_user, p_market_id, p_outcome, p_action, p_limit_price, p_quantity,
      0, 0, p_quantity, p_time_in_force,
      p_action = 'sell', 'rejected', p_client_order_id, p_quote_id, v_quote.worst_execution_price, 'self-trade rejected',
      v_expires_at
    ) returning * into v_order;
    return exchange_order_response_v2(v_order, v_market);
  end if;

  v_fillable := exchange_available_crossing_quantity_v2(p_market_id, p_outcome, p_action, p_limit_price, v_user);
  if p_time_in_force = 'FOK' and v_fillable < p_quantity then
    insert into exchange_orders (
      user_id, market_id, outcome, action, limit_price, original_quantity,
      filled_quantity, remaining_quantity, cancelled_quantity, time_in_force,
      reduce_only, status, client_order_id, quote_id, accepted_worst_price, rejected_reason, expires_at
    ) values (
      v_user, p_market_id, p_outcome, p_action, p_limit_price, p_quantity,
      0, 0, p_quantity, p_time_in_force,
      p_action = 'sell', 'rejected', p_client_order_id, p_quote_id, v_quote.worst_execution_price, 'FOK cannot fully fill',
      null
    ) returning * into v_order;
    return exchange_order_response_v2(v_order, v_market);
  end if;

  insert into exchange_orders (
    user_id, market_id, outcome, action, limit_price, original_quantity,
    filled_quantity, remaining_quantity, cancelled_quantity, time_in_force,
    reduce_only, status, client_order_id, quote_id, accepted_worst_price, expires_at
  ) values (
    v_user, p_market_id, p_outcome, p_action, p_limit_price, p_quantity,
    0, p_quantity, 0, p_time_in_force,
    p_action = 'sell', 'open', p_client_order_id, p_quote_id, v_quote.worst_execution_price,
    v_expires_at
  ) returning * into v_order;

  perform exchange_log_risk_event_v2(
    v_user,
    p_market_id,
    p_outcome,
    v_order.id,
    coalesce(v_risk_result->>'eventType', 'order_allowed'),
    'info',
    'allowed',
    coalesce(v_risk_result->>'reason', 'risk limits passed'),
    v_risk_result
  );

  -- Reserve before order/fill mutation so every committed fill is fully collateralized.
  v_reservation := exchange_reserve_order_collateral_v2(v_order.id);

  v_match := exchange_match_order_v2(v_order.id);
  select * into v_order from exchange_orders where id = v_order.id for update;

  -- FOK is all-or-none. The pre-match fillable check is an estimate; if actual
  -- matching changes under concurrency, raise so the transaction rolls back any
  -- partial fills, ledger entries, and position updates.
  if p_time_in_force = 'FOK' and v_order.filled_quantity < v_order.original_quantity then
    raise exception 'FOK fillability changed; requote required';
  end if;

  if p_time_in_force in ('IOC','FOK') and v_order.remaining_quantity > 0 then
    v_cancel_qty := v_order.remaining_quantity;
    perform exchange_release_order_reservation_v2(v_order.id, lower(p_time_in_force::text) || '_unfilled');
    update exchange_orders
    set status = case when filled_quantity > 0 then 'cancelled' else 'rejected' end,
        rejected_reason = case when filled_quantity > 0 then rejected_reason else p_time_in_force::text || ' unfilled' end,
        cancelled_quantity = cancelled_quantity + v_cancel_qty,
        remaining_quantity = 0,
        updated_at = now()
    where id = v_order.id
    returning * into v_order;
  end if;

  update exchange_markets
  set book_version = book_version + 1,
      last_trade_price = coalesce((select f.price from exchange_fills f where f.market_id = p_market_id order by f.created_at desc limit 1), last_trade_price),
      mark_price = coalesce((select f.price from exchange_fills f where f.market_id = p_market_id order by f.created_at desc limit 1), mark_price),
      updated_at = now()
  where market_id = p_market_id
  returning * into v_market;

  select * into v_order from exchange_orders where id = v_order.id;

  insert into exchange_audit_events (actor_user_id, event_type, aggregate_type, aggregate_id, aggregate_version, metadata)
  values (
    v_user,
    'exchange_order_matched',
    'exchange_order',
    v_order.id,
    v_market.book_version,
    jsonb_build_object('match', v_match, 'timeInForce', p_time_in_force, 'expiresAt', v_expires_at, 'fokPreMatchFillableQuantity', v_fillable, 'risk', v_risk_result, 'productionGateTouched', false)
  );

  return exchange_order_response_v2(v_order, v_market);
exception when others then
  raise;
end;
$$;

create or replace function place_order_v2(
  p_market_id uuid,
  p_outcome exchange_outcome,
  p_action exchange_order_action,
  p_quantity numeric,
  p_limit_price numeric,
  p_time_in_force exchange_time_in_force,
  p_client_order_id text,
  p_quote_id uuid,
  p_environment text default 'production'
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select place_order_v2(
    p_market_id,
    p_outcome,
    p_action,
    p_quantity,
    p_limit_price,
    p_time_in_force,
    p_client_order_id,
    p_quote_id,
    p_environment,
    null::timestamptz
  );
$$;

revoke all on table exchange_risk_limits from public, anon, authenticated;
revoke all on table exchange_risk_events from public, anon, authenticated;
revoke all on table exchange_market_controls from public, anon, authenticated;

revoke all on function exchange_risk_limits_for_environment_v2(text) from public, anon, authenticated;
revoke all on function exchange_log_risk_event_v2(uuid, uuid, exchange_outcome, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function exchange_order_notional_v2(numeric, numeric) from public, anon, authenticated;
revoke all on function exchange_user_open_order_count_v2(uuid, uuid) from public, anon, authenticated;
revoke all on function exchange_user_market_gross_notional_v2(uuid, uuid) from public, anon, authenticated;
revoke all on function exchange_recent_order_count_v2(uuid, integer) from public, anon, authenticated;
revoke all on function exchange_check_order_risk_limits_v2(uuid, uuid, exchange_outcome, exchange_order_action, numeric, numeric, text) from public, anon, authenticated;
revoke all on function exchange_reject_order_for_risk_v2(uuid, uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, numeric, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function pause_exchange_market_v2(uuid, text) from public, anon, authenticated;
revoke all on function resume_exchange_market_v2(uuid, text) from public, anon, authenticated;
revoke all on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text) from public, anon;
revoke all on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text, timestamptz) from public, anon;

grant execute on function pause_exchange_market_v2(uuid, text) to authenticated, service_role;
grant execute on function resume_exchange_market_v2(uuid, text) to authenticated, service_role;
grant execute on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text) to authenticated;
grant execute on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text, timestamptz) to authenticated;
