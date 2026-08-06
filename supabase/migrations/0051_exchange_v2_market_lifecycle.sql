-- 0051_exchange_v2_market_lifecycle.sql — exchange-v2 market lifecycle
--
-- CODE-READY / HUMAN-GATED:
-- - Chris applies migrations manually; Hermes must not apply this file.
-- - Production trading remains disabled. This migration does not update the
--   production exchange_feature_gates row and does not enable any gate.
-- - Legacy fixed-odds records keep engine_version='legacy_fixed_odds'. Only this
--   explicit curator/service RPC may promote a rumor into exchange_v2.

create or replace function exchange_current_request_role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.role(), 'anon');
$$;

create or replace function exchange_require_curator_or_service()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exchange_current_request_role() = 'service_role' then
    return;
  end if;

  if auth.uid() is null or not is_curator() then
    raise exception 'not a curator';
  end if;
end;
$$;

create or replace function exchange_validate_market_lifecycle_config(
  p_close_at timestamptz,
  p_resolve_by_at timestamptz,
  p_tick_size numeric,
  p_quantity_step numeric,
  p_min_order_quantity numeric,
  p_opening_mark_price numeric,
  p_required_source_count integer,
  p_fee_bps integer
)
returns void
language plpgsql
stable
as $$
begin
  if p_close_at is null or p_close_at <= now() then
    raise exception 'close_at must be in the future';
  end if;

  if p_resolve_by_at is not null and p_resolve_by_at < p_close_at then
    raise exception 'resolve_by_at must be on or after close_at';
  end if;

  if p_tick_size is null or p_tick_size <= 0 or p_tick_size > 1 then
    raise exception 'tick_size must be between 0 and 1';
  end if;

  if p_quantity_step is null or p_quantity_step <= 0 then
    raise exception 'quantity_step must be positive';
  end if;

  if p_min_order_quantity is null or p_min_order_quantity <= 0 then
    raise exception 'min_order_quantity must be positive';
  end if;

  if p_opening_mark_price is null or p_opening_mark_price < 0 or p_opening_mark_price > 1 then
    raise exception 'opening_mark_price must be between 0 and 1';
  end if;

  if p_required_source_count is null or p_required_source_count < 1 then
    raise exception 'required_source_count must be at least 1';
  end if;

  if p_fee_bps is null or p_fee_bps < 0 then
    raise exception 'fee_bps must be zero or positive';
  end if;

  perform exchange_assert_tick(p_opening_mark_price, p_tick_size, 'opening_mark_price');
  perform exchange_assert_tick(p_min_order_quantity, p_quantity_step, 'min_order_quantity');
end;
$$;

create or replace function exchange_market_lifecycle_response(p_market_id uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'marketId', m.market_id,
    'engineVersion', m.engine_version,
    'state', m.state,
    'closeAt', m.close_at,
    'resolveByAt', m.resolve_by_at,
    'resolutionPolicy', m.resolution_policy,
    'requiredSourceCount', m.required_source_count,
    'tickSize', m.tick_size,
    'quantityStep', m.quantity_step,
    'minOrderQuantity', m.min_order_quantity,
    'feeBps', m.fee_bps,
    'markProbability', m.mark_price,
    'bookVersion', m.book_version,
    'updatedAt', m.updated_at
  )
  from exchange_markets m
  where m.market_id = p_market_id;
$$;

create or replace function promote_rumor_to_exchange_market_v2(
  p_rumor_id uuid,
  p_close_at timestamptz,
  p_resolve_by_at timestamptz default null,
  p_resolution_policy text default 'evidence',
  p_required_source_count integer default 2,
  p_tick_size numeric default 0.01000000,
  p_quantity_step numeric default 0.000001,
  p_min_order_quantity numeric default 1.000000,
  p_opening_mark_price numeric default 0.50000000,
  p_fee_bps integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rumor rumors;
  v_existing exchange_markets;
begin
  perform exchange_require_curator_or_service();

  if p_resolution_policy not in ('evidence', 'deadline') then
    raise exception 'resolution_policy must be evidence or deadline';
  end if;

  perform exchange_validate_market_lifecycle_config(
    p_close_at,
    p_resolve_by_at,
    p_tick_size,
    p_quantity_step,
    p_min_order_quantity,
    p_opening_mark_price,
    p_required_source_count,
    p_fee_bps
  );

  select * into v_rumor
  from rumors
  where id = p_rumor_id
  for update;

  if not found then
    raise exception 'rumor not found';
  end if;

  select * into v_existing
  from exchange_markets
  where market_id = p_rumor_id
  for update;

  if found and v_existing.state <> 'draft' then
    raise exception 'exchange market configuration is locked after draft';
  end if;

  if v_rumor.engine_version <> 'legacy_fixed_odds' and v_rumor.engine_version <> 'exchange_v2' then
    raise exception 'unsupported engine_version';
  end if;

  insert into exchange_markets (
    market_id,
    engine_version,
    state,
    close_at,
    resolve_by_at,
    resolution_policy,
    required_source_count,
    tick_size,
    quantity_step,
    min_order_quantity,
    fee_bps,
    mark_price,
    book_version,
    updated_at
  ) values (
    p_rumor_id,
    'exchange_v2',
    'draft',
    p_close_at,
    p_resolve_by_at,
    p_resolution_policy,
    p_required_source_count,
    p_tick_size,
    p_quantity_step,
    p_min_order_quantity,
    p_fee_bps,
    p_opening_mark_price,
    0,
    now()
  )
  on conflict (market_id) do update set
    close_at = excluded.close_at,
    resolve_by_at = excluded.resolve_by_at,
    resolution_policy = excluded.resolution_policy,
    required_source_count = excluded.required_source_count,
    tick_size = excluded.tick_size,
    quantity_step = excluded.quantity_step,
    min_order_quantity = excluded.min_order_quantity,
    fee_bps = excluded.fee_bps,
    mark_price = excluded.mark_price,
    updated_at = now();

  update rumors
  set engine_version = 'exchange_v2',
      prediction_deadline = p_close_at,
      resolve_by_at = p_resolve_by_at
  where id = p_rumor_id;

  insert into exchange_audit_events (actor_user_id, event_type, aggregate_type, aggregate_id, aggregate_version, metadata)
  values (
    auth.uid(),
    'exchange_market_promoted',
    'exchange_market',
    p_rumor_id,
    0,
    jsonb_build_object(
      'resolutionPolicy', p_resolution_policy,
      'requiredSourceCount', p_required_source_count,
      'tickSize', p_tick_size,
      'quantityStep', p_quantity_step,
      'openingMarkPrice', p_opening_mark_price,
      'feeBps', p_fee_bps
    )
  );

  return exchange_market_lifecycle_response(p_rumor_id);
end;
$$;

create or replace function open_exchange_market_v2(p_market_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market exchange_markets;
begin
  perform exchange_require_curator_or_service();

  select * into v_market
  from exchange_markets
  where market_id = p_market_id
  for update;

  if not found then
    raise exception 'exchange market not found';
  end if;

  if v_market.state <> 'draft' then
    raise exception 'exchange market can only open from draft';
  end if;

  if v_market.close_at <= now() then
    raise exception 'exchange market close_at has already passed';
  end if;

  update exchange_markets
  set state = 'open',
      book_version = book_version + 1,
      updated_at = now()
  where market_id = p_market_id;

  insert into exchange_audit_events (actor_user_id, event_type, aggregate_type, aggregate_id, aggregate_version, metadata)
  values (auth.uid(), 'exchange_market_opened', 'exchange_market', p_market_id, v_market.book_version + 1, '{}'::jsonb);

  return exchange_market_lifecycle_response(p_market_id);
end;
$$;

create or replace function close_exchange_market_v2(p_market_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market exchange_markets;
begin
  perform exchange_require_curator_or_service();

  select * into v_market
  from exchange_markets
  where market_id = p_market_id
  for update;

  if not found then
    raise exception 'exchange market not found';
  end if;

  if v_market.state <> 'open' then
    raise exception 'exchange market can only close from open';
  end if;

  update exchange_markets
  set state = 'closed',
      book_version = book_version + 1,
      updated_at = now()
  where market_id = p_market_id;

  insert into exchange_audit_events (actor_user_id, event_type, aggregate_type, aggregate_id, aggregate_version, metadata)
  values (auth.uid(), 'exchange_market_closed', 'exchange_market', p_market_id, v_market.book_version + 1, '{}'::jsonb);

  return exchange_market_lifecycle_response(p_market_id);
end;
$$;

revoke all on function exchange_current_request_role() from public, anon, authenticated;
revoke all on function exchange_require_curator_or_service() from public, anon, authenticated;
revoke all on function exchange_validate_market_lifecycle_config(timestamptz, timestamptz, numeric, numeric, numeric, numeric, integer, integer) from public, anon, authenticated;
revoke all on function exchange_market_lifecycle_response(uuid) from public, anon, authenticated;
revoke all on function promote_rumor_to_exchange_market_v2(uuid, timestamptz, timestamptz, text, integer, numeric, numeric, numeric, numeric, integer) from public, anon;
revoke all on function open_exchange_market_v2(uuid) from public, anon;
revoke all on function close_exchange_market_v2(uuid) from public, anon;

grant execute on function promote_rumor_to_exchange_market_v2(uuid, timestamptz, timestamptz, text, integer, numeric, numeric, numeric, numeric, integer) to authenticated, service_role;
grant execute on function open_exchange_market_v2(uuid) to authenticated, service_role;
grant execute on function close_exchange_market_v2(uuid) to authenticated, service_role;
