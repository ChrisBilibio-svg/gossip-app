-- 0050_exchange_v2_foundation.sql — prediction-exchange v2 foundation
--
-- CODE-READY / HUMAN-GATED:
-- 1. Do not apply until Chris approves Supabase migration execution.
-- 2. Production trading defaults disabled and must remain disabled until owner,
--    Brazil legal/platform, and store review approval is explicitly recorded.
-- 3. Coins remain closed-loop entertainment currency with no cash value.
-- 4. This migration adds immutable engine routing plus v2 exchange tables/RPC
--    shells that fail closed unless feature gates are enabled.

create extension if not exists pgcrypto;

-- Engine routing: legacy fixed-odds records keep their original behavior. New v2
-- markets opt in explicitly; one user action must never dual-write engines.
do $$ begin
  create type market_engine_version as enum ('legacy_fixed_odds', 'exchange_v2');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type exchange_market_state as enum ('draft', 'open', 'paused', 'closed', 'resolved', 'voided');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type exchange_outcome as enum ('true', 'false');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type exchange_order_action as enum ('buy', 'sell');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type exchange_order_status as enum ('open', 'partially_filled', 'filled', 'cancelled', 'expired', 'rejected');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type exchange_time_in_force as enum ('GTC', 'GTD', 'IOC', 'FOK');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type exchange_reservation_kind as enum ('coin', 'share');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type exchange_settlement_outcome as enum ('true', 'false', 'void');
exception when duplicate_object then null;
end $$;

alter table rumors
  add column if not exists engine_version market_engine_version not null default 'legacy_fixed_odds';

alter table fixed_prediction_positions
  add column if not exists engine_version market_engine_version not null default 'legacy_fixed_odds';

create table if not exists exchange_feature_gates (
  environment text primary key check (environment in ('development', 'preview', 'production')),
  trading_enabled boolean not null default false,
  selling_enabled boolean not null default false,
  market_maker_enabled boolean not null default false,
  fees_enabled boolean not null default false,
  production_approved boolean not null default false,
  approval_reference text,
  updated_at timestamptz not null default now(),
  check (environment <> 'production' or (not trading_enabled or production_approved))
);

insert into exchange_feature_gates (environment) values ('development'), ('preview'), ('production')
on conflict (environment) do nothing;

create table if not exists exchange_markets (
  market_id uuid primary key references rumors (id) on delete cascade,
  engine_version market_engine_version not null default 'exchange_v2' check (engine_version = 'exchange_v2'),
  state exchange_market_state not null default 'draft',
  close_at timestamptz not null,
  resolve_by_at timestamptz,
  resolution_policy text not null check (resolution_policy in ('evidence', 'deadline')),
  required_source_count integer not null default 2 check (required_source_count >= 1),
  tick_size numeric(18,8) not null default 0.01000000 check (tick_size > 0 and tick_size <= 1),
  quantity_step numeric(24,6) not null default 0.000001 check (quantity_step > 0),
  min_order_quantity numeric(24,6) not null default 1.000000 check (min_order_quantity > 0),
  fee_bps integer not null default 0 check (fee_bps >= 0),
  settlement_value_win numeric(18,8) not null default 1.00000000 check (settlement_value_win = 1.00000000),
  settlement_value_void numeric(18,8) not null default 0.50000000 check (settlement_value_void = 0.50000000),
  mark_price numeric(18,8) not null default 0.50000000 check (mark_price >= 0 and mark_price <= 1),
  last_trade_price numeric(18,8),
  book_version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists exchange_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  market_id uuid not null references exchange_markets (market_id) on delete cascade,
  outcome exchange_outcome not null,
  action exchange_order_action not null,
  limit_price numeric(18,8) not null check (limit_price >= 0 and limit_price <= 1),
  original_quantity numeric(24,6) not null check (original_quantity > 0),
  filled_quantity numeric(24,6) not null default 0 check (filled_quantity >= 0),
  remaining_quantity numeric(24,6) not null check (remaining_quantity >= 0),
  cancelled_quantity numeric(24,6) not null default 0 check (cancelled_quantity >= 0),
  time_in_force exchange_time_in_force not null default 'GTC',
  reduce_only boolean not null default false,
  status exchange_order_status not null default 'open',
  expires_at timestamptz,
  reservation_id uuid,
  client_order_id text not null check (char_length(client_order_id) between 12 and 120),
  quote_id uuid,
  accepted_worst_price numeric(18,8) check (accepted_worst_price is null or (accepted_worst_price >= 0 and accepted_worst_price <= 1)),
  rejected_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (original_quantity = filled_quantity + remaining_quantity + cancelled_quantity),
  check ((time_in_force <> 'GTD' and expires_at is null) or (time_in_force = 'GTD' and expires_at is not null)),
  unique (user_id, client_order_id)
);

create index if not exists exchange_orders_book_buy_idx on exchange_orders (market_id, outcome, limit_price desc, created_at, id) where action = 'buy' and status in ('open','partially_filled');
create index if not exists exchange_orders_book_sell_idx on exchange_orders (market_id, outcome, limit_price asc, created_at, id) where action = 'sell' and status in ('open','partially_filled');
create index if not exists exchange_orders_user_created_idx on exchange_orders (user_id, created_at desc);

create table if not exists exchange_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  market_id uuid not null references exchange_markets (market_id) on delete cascade,
  outcome exchange_outcome,
  kind exchange_reservation_kind not null,
  quantity numeric(24,6) not null check (quantity >= 0),
  released_quantity numeric(24,6) not null default 0 check (released_quantity >= 0),
  order_id uuid,
  status text not null default 'active' check (status in ('active','released','consumed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (released_quantity <= quantity)
);

alter table exchange_orders
  drop constraint if exists exchange_orders_reservation_id_fkey,
  add constraint exchange_orders_reservation_id_fkey foreign key (reservation_id) references exchange_reservations (id) on delete set null;

create table if not exists exchange_fills (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references exchange_markets (market_id) on delete cascade,
  outcome exchange_outcome not null,
  maker_order_id uuid not null references exchange_orders (id),
  taker_order_id uuid not null references exchange_orders (id),
  maker_user_id uuid not null references auth.users (id),
  taker_user_id uuid not null references auth.users (id),
  quantity numeric(24,6) not null check (quantity > 0),
  price numeric(18,8) not null check (price >= 0 and price <= 1),
  maker_fee numeric(24,6) not null default 0 check (maker_fee >= 0),
  taker_fee numeric(24,6) not null default 0 check (taker_fee >= 0),
  book_version bigint not null,
  created_at timestamptz not null default now(),
  check (maker_user_id <> taker_user_id)
);

create index if not exists exchange_fills_market_created_idx on exchange_fills (market_id, created_at desc);
create index if not exists exchange_fills_user_idx on exchange_fills (maker_user_id, created_at desc);
create index if not exists exchange_fills_taker_user_idx on exchange_fills (taker_user_id, created_at desc);

create table if not exists exchange_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  market_id uuid not null references exchange_markets (market_id) on delete cascade,
  outcome exchange_outcome not null,
  quantity numeric(24,6) not null default 0 check (quantity >= 0),
  reserved_sell_quantity numeric(24,6) not null default 0 check (reserved_sell_quantity >= 0),
  cost_basis numeric(24,6) not null default 0 check (cost_basis >= 0),
  average_entry_price numeric(18,8) not null default 0 check (average_entry_price >= 0 and average_entry_price <= 1),
  realized_pnl numeric(24,6) not null default 0,
  fees_paid numeric(24,6) not null default 0 check (fees_paid >= 0),
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, market_id, outcome),
  check (reserved_sell_quantity <= quantity)
);

create table if not exists exchange_wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  user_id uuid references auth.users (id) on delete cascade,
  market_id uuid references exchange_markets (market_id) on delete cascade,
  entry_type text not null check (entry_type in ('reserve_coin','release_coin','spend_coin','credit_coin','reserve_share','release_share','debit_share','credit_share','fee','settlement')),
  amount numeric(24,6) not null,
  currency text not null check (currency in ('COIN','SHARE_TRUE','SHARE_FALSE')),
  order_id uuid references exchange_orders (id),
  fill_id uuid references exchange_fills (id),
  settlement_id uuid,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (idempotency_key)
);

create index if not exists exchange_wallet_ledger_user_created_idx on exchange_wallet_ledger (user_id, created_at desc);
create index if not exists exchange_wallet_ledger_event_idx on exchange_wallet_ledger (event_id);

create table if not exists exchange_order_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  market_id uuid not null references exchange_markets (market_id) on delete cascade,
  outcome exchange_outcome not null,
  action exchange_order_action not null,
  requested_quantity numeric(24,6) not null check (requested_quantity > 0),
  requested_limit_price numeric(18,8) not null check (requested_limit_price >= 0 and requested_limit_price <= 1),
  estimated_fillable_quantity numeric(24,6) not null check (estimated_fillable_quantity >= 0),
  estimated_average_price numeric(18,8),
  worst_execution_price numeric(18,8),
  estimated_fees numeric(24,6) not null default 0,
  spread numeric(18,8),
  slippage numeric(18,8),
  book_version bigint not null,
  expires_at timestamptz not null,
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  created_at timestamptz not null default now()
);

create table if not exists exchange_settlements (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references exchange_markets (market_id) on delete cascade,
  outcome exchange_settlement_outcome not null,
  settlement_value_true numeric(18,8) not null check (settlement_value_true >= 0 and settlement_value_true <= 1),
  settlement_value_false numeric(18,8) not null check (settlement_value_false >= 0 and settlement_value_false <= 1),
  settled_by uuid references auth.users (id) on delete set null,
  evidence_reference text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  unique (market_id)
);

create table if not exists exchange_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  event_type text not null check (char_length(event_type) between 3 and 120),
  aggregate_type text not null,
  aggregate_id uuid,
  aggregate_version bigint,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists exchange_risk_events (
  id uuid primary key default gen_random_uuid(),
  market_id uuid references exchange_markets (market_id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  event_type text not null,
  severity text not null check (severity in ('info','warn','block','critical')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create or replace function exchange_assert_tick(p_value numeric, p_tick numeric, p_label text)
returns void
language plpgsql
immutable
as $$
begin
  if p_value is null or p_tick is null or p_tick <= 0 then
    raise exception '% invalid', p_label;
  end if;
  if mod(round(p_value / p_tick), 1) <> 0 then
    raise exception '% violates tick/step', p_label;
  end if;
end;
$$;

create or replace function exchange_market_lock_key(p_market_id uuid, p_outcome exchange_outcome)
returns bigint
language sql
immutable
as $$
  select ('x' || substr(md5(p_market_id::text || ':' || p_outcome::text), 1, 16))::bit(64)::bigint;
$$;

create or replace function exchange_gate_allows(p_environment text, p_action exchange_order_action)
returns boolean
language sql
stable
as $$
  select coalesce(
    (g.trading_enabled and (p_action = 'buy' or (p_action = 'sell' and g.selling_enabled)) and (g.environment <> 'production' or g.production_approved)),
    false
  )
  from exchange_feature_gates g
  where g.environment = coalesce(nullif(p_environment, ''), 'production');
$$;

create or replace function get_market_snapshot_v2(p_market_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market exchange_markets;
  v_best_bid numeric;
  v_best_ask numeric;
  v_last numeric;
begin
  select * into v_market from exchange_markets where market_id = p_market_id;
  if not found then raise exception 'market not found'; end if;

  select max(limit_price) into v_best_bid from exchange_orders where market_id = p_market_id and action = 'buy' and status in ('open','partially_filled') and remaining_quantity > 0;
  select min(limit_price) into v_best_ask from exchange_orders where market_id = p_market_id and action = 'sell' and status in ('open','partially_filled') and remaining_quantity > 0;
  select price into v_last from exchange_fills where market_id = p_market_id order by created_at desc limit 1;

  return jsonb_build_object(
    'marketId', p_market_id,
    'engineVersion', 'exchange_v2',
    'state', v_market.state,
    'bookVersion', v_market.book_version,
    'markProbability', case when v_best_bid is not null and v_best_ask is not null then round((v_best_bid + v_best_ask) / 2, 8) else coalesce(v_last, v_market.mark_price) end,
    'lastTradePrice', v_last,
    'bestBid', v_best_bid,
    'bestAsk', v_best_ask,
    'tickSize', v_market.tick_size,
    'quantityStep', v_market.quantity_step,
    'updatedAt', v_market.updated_at
  );
end;
$$;

create or replace function quote_order_v2(
  p_market_id uuid,
  p_outcome exchange_outcome,
  p_action exchange_order_action,
  p_quantity numeric,
  p_limit_price numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_market exchange_markets;
  v_best_opposing numeric;
  v_quote exchange_order_quotes;
  v_warnings jsonb := '[]'::jsonb;
begin
  if v_user is null then raise exception 'auth required'; end if;
  select * into v_market from exchange_markets where market_id = p_market_id for share;
  if not found or v_market.state <> 'open' or v_market.close_at <= now() then
    raise exception 'market is not open';
  end if;
  perform exchange_assert_tick(p_limit_price, v_market.tick_size, 'limit_price');
  perform exchange_assert_tick(p_quantity, v_market.quantity_step, 'quantity');

  if p_action = 'buy' then
    select min(limit_price) into v_best_opposing from exchange_orders where market_id = p_market_id and outcome = p_outcome and action = 'sell' and status in ('open','partially_filled') and remaining_quantity > 0 and limit_price <= p_limit_price;
  else
    select max(limit_price) into v_best_opposing from exchange_orders where market_id = p_market_id and outcome = p_outcome and action = 'buy' and status in ('open','partially_filled') and remaining_quantity > 0 and limit_price >= p_limit_price;
  end if;

  if v_best_opposing is null then
    v_warnings := v_warnings || jsonb_build_array('Sem liquidez suficiente agora; uma ordem limite pode ficar aguardando contraparte.');
  end if;

  insert into exchange_order_quotes (
    user_id, market_id, outcome, action, requested_quantity, requested_limit_price,
    estimated_fillable_quantity, estimated_average_price, worst_execution_price,
    estimated_fees, spread, slippage, book_version, expires_at, warnings
  ) values (
    v_user, p_market_id, p_outcome, p_action, p_quantity, p_limit_price,
    case when v_best_opposing is null then 0 else p_quantity end,
    v_best_opposing,
    case when v_best_opposing is null then null else p_limit_price end,
    0,
    null,
    case when v_best_opposing is null then null else abs(p_limit_price - v_best_opposing) end,
    v_market.book_version,
    now() + interval '20 seconds',
    v_warnings
  ) returning * into v_quote;

  return jsonb_build_object(
    'quoteId', v_quote.id,
    'marketId', p_market_id,
    'bookVersion', v_quote.book_version,
    'expiresAt', v_quote.expires_at,
    'action', p_action,
    'outcome', p_outcome,
    'requestedLimitPrice', p_limit_price,
    'requestedQuantity', p_quantity,
    'estimatedFillableQuantity', v_quote.estimated_fillable_quantity,
    'estimatedAverageExecutionPrice', v_quote.estimated_average_price,
    'worstExecutionPrice', v_quote.worst_execution_price,
    'fees', 0,
    'warnings', v_warnings
  );
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
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_market exchange_markets;
  v_quote exchange_order_quotes;
  v_order exchange_orders;
begin
  if v_user is null then raise exception 'auth required'; end if;
  if not exchange_gate_allows(p_environment, p_action) then
    raise exception 'exchange trading is disabled';
  end if;

  perform pg_advisory_xact_lock(exchange_market_lock_key(p_market_id, p_outcome));
  select * into v_market from exchange_markets where market_id = p_market_id for update;
  if not found or v_market.state <> 'open' or v_market.close_at <= now() then
    raise exception 'market is not open';
  end if;

  select * into v_quote from exchange_order_quotes where id = p_quote_id and user_id = v_user for update;
  if not found or v_quote.expires_at <= now() or v_quote.book_version <> v_market.book_version then
    raise exception 'quote expired or stale; requote required';
  end if;
  if v_quote.market_id <> p_market_id or v_quote.outcome <> p_outcome or v_quote.action <> p_action or v_quote.requested_limit_price <> p_limit_price or v_quote.requested_quantity <> p_quantity then
    raise exception 'quote changed; requote required';
  end if;

  -- Foundation behavior: server-authoritative order acceptance with idempotency,
  -- reservations, and matching hooks. Full multi-level matching is implemented in
  -- a follow-up migration before gates can be enabled.
  insert into exchange_orders (
    user_id, market_id, outcome, action, limit_price, original_quantity,
    filled_quantity, remaining_quantity, cancelled_quantity, time_in_force,
    reduce_only, status, client_order_id, quote_id, accepted_worst_price
  ) values (
    v_user, p_market_id, p_outcome, p_action, p_limit_price, p_quantity,
    0, p_quantity, 0, p_time_in_force,
    p_action = 'sell', 'open', p_client_order_id, p_quote_id, v_quote.worst_execution_price
  ) on conflict (user_id, client_order_id) do update set updated_at = exchange_orders.updated_at
  returning * into v_order;

  update exchange_markets set book_version = book_version + 1, updated_at = now() where market_id = p_market_id returning * into v_market;

  return jsonb_build_object(
    'orderId', v_order.id,
    'status', v_order.status,
    'filledQuantity', v_order.filled_quantity,
    'remainingQuantity', v_order.remaining_quantity,
    'actualAverageFillPrice', null,
    'fees', 0,
    'bookVersion', v_market.book_version,
    'cashOutDisclosure', 'Venda sua posição enquanto o mercado estiver aberto, sujeita à liquidez.'
  );
end;
$$;

create or replace function quote_cash_out_v1(p_market_id uuid, p_outcome exchange_outcome, p_quantity numeric)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select quote_order_v2(p_market_id, p_outcome, 'sell', p_quantity, coalesce((select max(limit_price) from exchange_orders where market_id = p_market_id and outcome = p_outcome and action = 'buy' and status in ('open','partially_filled')), 0));
$$;

create or replace function sell_position_v1(
  p_market_id uuid,
  p_outcome exchange_outcome,
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
  select place_order_v2(p_market_id, p_outcome, 'sell', p_quantity, p_limit_price, p_time_in_force, p_client_order_id, p_quote_id, p_environment);
$$;

create or replace function cancel_order_v1(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order exchange_orders;
begin
  if v_user is null then raise exception 'auth required'; end if;
  select * into v_order from exchange_orders where id = p_order_id and user_id = v_user for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.status not in ('open','partially_filled') then
    return jsonb_build_object('orderId', p_order_id, 'status', v_order.status);
  end if;
  update exchange_orders
  set status = 'cancelled', cancelled_quantity = remaining_quantity, remaining_quantity = 0, updated_at = now()
  where id = p_order_id
  returning * into v_order;
  update exchange_markets set book_version = book_version + 1, updated_at = now() where market_id = v_order.market_id;
  return jsonb_build_object('orderId', p_order_id, 'status', v_order.status, 'releasedQuantity', v_order.cancelled_quantity);
end;
$$;

create or replace function get_portfolio_v2()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'positions', coalesce(jsonb_agg(to_jsonb(p) order by p.updated_at desc) filter (where p.id is not null), '[]'::jsonb),
    'cashOutDisclosure', 'Venda sua posição enquanto o mercado estiver aberto, sujeita à liquidez.'
  )
  from exchange_positions p
  where p.user_id = auth.uid();
$$;

create or replace function get_trade_receipt_v1(p_order_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'orderId', o.id,
    'marketId', o.market_id,
    'outcome', o.outcome,
    'action', o.action,
    'status', o.status,
    'coinsRequested', case when o.action = 'buy' then o.original_quantity * o.limit_price else null end,
    'sharesRequested', o.original_quantity,
    'sharesFilled', o.filled_quantity,
    'sharesRemaining', o.remaining_quantity,
    'requestedLimitPrice', o.limit_price,
    'actualAverageFillPrice', (select case when sum(f.quantity) > 0 then sum(f.quantity * f.price) / sum(f.quantity) end from exchange_fills f where f.maker_order_id = o.id or f.taker_order_id = o.id),
    'fees', 0,
    'orderTimestamp', o.created_at,
    'cashOutDisclosure', 'Venda sua posição enquanto o mercado estiver aberto, sujeita à liquidez.'
  )
  from exchange_orders o
  where o.id = p_order_id and o.user_id = auth.uid();
$$;

create or replace function resolve_market_v2(p_market_id uuid, p_outcome exchange_settlement_outcome, p_reference text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_true_value numeric := case when p_outcome = 'true' then 1 when p_outcome = 'void' then 0.5 else 0 end;
  v_false_value numeric := case when p_outcome = 'false' then 1 when p_outcome = 'void' then 0.5 else 0 end;
  v_settlement exchange_settlements;
begin
  insert into exchange_settlements (market_id, outcome, settlement_value_true, settlement_value_false, settled_by, evidence_reference, idempotency_key)
  values (p_market_id, p_outcome, v_true_value, v_false_value, auth.uid(), p_reference, p_idempotency_key)
  on conflict (idempotency_key) do update set idempotency_key = exchange_settlements.idempotency_key
  returning * into v_settlement;

  update exchange_orders
  set status = 'cancelled', cancelled_quantity = remaining_quantity, remaining_quantity = 0, updated_at = now()
  where market_id = p_market_id and status in ('open','partially_filled');

  update exchange_markets set state = case when p_outcome = 'void' then 'voided' else 'resolved' end, book_version = book_version + 1, updated_at = now()
  where market_id = p_market_id;

  return jsonb_build_object('settlementId', v_settlement.id, 'marketId', p_market_id, 'outcome', p_outcome, 'trueValue', v_true_value, 'falseValue', v_false_value);
end;
$$;

alter table exchange_feature_gates enable row level security;
alter table exchange_markets enable row level security;
alter table exchange_orders enable row level security;
alter table exchange_reservations enable row level security;
alter table exchange_fills enable row level security;
alter table exchange_positions enable row level security;
alter table exchange_wallet_ledger enable row level security;
alter table exchange_order_quotes enable row level security;
alter table exchange_settlements enable row level security;
alter table exchange_audit_events enable row level security;
alter table exchange_risk_events enable row level security;

create policy "read exchange markets" on exchange_markets for select to authenticated using (true);
create policy "read own exchange orders" on exchange_orders for select to authenticated using (user_id = auth.uid());
create policy "read own exchange reservations" on exchange_reservations for select to authenticated using (user_id = auth.uid());
create policy "read own exchange positions" on exchange_positions for select to authenticated using (user_id = auth.uid());
create policy "read own exchange ledger" on exchange_wallet_ledger for select to authenticated using (user_id = auth.uid());
create policy "read own exchange quotes" on exchange_order_quotes for select to authenticated using (user_id = auth.uid());
create policy "read market fills" on exchange_fills for select to authenticated using (true);

revoke all on exchange_feature_gates, exchange_markets, exchange_orders, exchange_reservations, exchange_fills, exchange_positions, exchange_wallet_ledger, exchange_order_quotes, exchange_settlements, exchange_audit_events, exchange_risk_events from anon, authenticated;
grant select on exchange_markets, exchange_fills to authenticated;
grant select on exchange_orders, exchange_reservations, exchange_positions, exchange_wallet_ledger, exchange_order_quotes to authenticated;

revoke all on function get_market_snapshot_v2(uuid) from public, anon;
revoke all on function quote_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric) from public, anon;
revoke all on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text) from public, anon;
revoke all on function quote_cash_out_v1(uuid, exchange_outcome, numeric) from public, anon;
revoke all on function sell_position_v1(uuid, exchange_outcome, numeric, numeric, exchange_time_in_force, text, uuid, text) from public, anon;
revoke all on function cancel_order_v1(uuid) from public, anon;
revoke all on function get_portfolio_v2() from public, anon;
revoke all on function get_trade_receipt_v1(uuid) from public, anon;
revoke all on function resolve_market_v2(uuid, exchange_settlement_outcome, text, text) from public, anon, authenticated;

grant execute on function get_market_snapshot_v2(uuid) to authenticated;
grant execute on function quote_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric) to authenticated;
grant execute on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text) to authenticated;
grant execute on function quote_cash_out_v1(uuid, exchange_outcome, numeric) to authenticated;
grant execute on function sell_position_v1(uuid, exchange_outcome, numeric, numeric, exchange_time_in_force, text, uuid, text) to authenticated;
grant execute on function cancel_order_v1(uuid) to authenticated;
grant execute on function get_portfolio_v2() to authenticated;
grant execute on function get_trade_receipt_v1(uuid) to authenticated;
grant execute on function resolve_market_v2(uuid, exchange_settlement_outcome, text, text) to service_role;
