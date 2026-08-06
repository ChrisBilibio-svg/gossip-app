-- 0043_coin_economy_fixed_odds.sql — feature-flagged closed-loop coin economy + fixed odds
--
-- CODE-READY / HUMAN-GATED:
-- 1. Apply this migration only after platform age-rating review and Brazil legal review.
-- 2. The economy feature flag and all paid/grant/prediction kill switches default OFF.
-- 3. Coins are closed-loop entertainment currency: no cash value, no withdrawal,
--    no redemption, no transfer, no prizes, no crypto conversion.
-- 4. Rollback/disable: set economy_configs.is_active=false and every kill switch
--    to true; drop this migration's RPC grants if you must hard-disable writes.

create extension if not exists pgcrypto;

-- Enums are additive; guarded for SQL Editor reruns.
do $$ begin
  create type coin_wallet_transaction_type as enum (
    'STARTER_GRANT',
    'FREE_RECOVERY',
    'PRO_RECOVERY',
    'PRO_UPFRONT',
    'PRO_DAILY',
    'PACK_PURCHASE',
    'PREDICTION_STAKE',
    'PREDICTION_WIN_RETURN',
    'PREDICTION_VOID_REFUND',
    'NON_BET_SINK',
    'ADMIN_ADJUSTMENT'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type coin_purchase_type as enum ('SUBSCRIPTION', 'COIN_PACK');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type coin_purchase_status as enum ('PENDING', 'VERIFIED', 'REJECTED', 'REFUNDED', 'REVOKED', 'RESTORED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type pro_entitlement_status as enum ('ACTIVE', 'GRACE_PERIOD', 'BILLING_RETRY', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'REVOKED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type fixed_prediction_position_status as enum ('OPEN', 'WON', 'LOST', 'VOID');
exception when duplicate_object then null;
end $$;

create table if not exists economy_configs (
  version integer primary key,
  is_active boolean not null default false,
  purchases_killed boolean not null default true,
  subscription_grants_killed boolean not null default true,
  recovery_grants_killed boolean not null default true,
  prediction_placement_killed boolean not null default true,
  prediction_settlement_killed boolean not null default true,
  starter_grant_coins integer not null check (starter_grant_coins >= 0),
  free_daily_recovery_floor integer not null check (free_daily_recovery_floor >= 0),
  pro_daily_recovery_floor integer not null check (pro_daily_recovery_floor >= 0),
  pro_upfront_coins integer not null check (pro_upfront_coins >= 0),
  pro_daily_coins integer not null check (pro_daily_coins >= 0),
  pro_service_days integer not null check (pro_service_days > 0),
  standard_stake_coins integer not null check (standard_stake_coins > 0),
  quick_stake_coins integer[] not null,
  recommended_wallet_fraction numeric(8,4) not null check (recommended_wallet_fraction > 0 and recommended_wallet_fraction <= 1),
  max_wallet_fraction numeric(8,4) not null check (max_wallet_fraction > 0 and max_wallet_fraction <= 1),
  absolute_max_stake_coins integer not null check (absolute_max_stake_coins > 0),
  house_edge numeric(8,4) not null check (house_edge >= 0 and house_edge < 1),
  min_outcome_probability numeric(8,4) not null check (min_outcome_probability > 0 and min_outcome_probability < 1),
  max_outcome_probability numeric(8,4) not null check (max_outcome_probability > 0 and max_outcome_probability < 1),
  odds_storage_precision integer not null check (odds_storage_precision = 4),
  odds_display_precision integer not null check (odds_display_precision = 2),
  subscription_product_id text not null,
  small_pack_product_id text not null,
  medium_pack_product_id text not null,
  large_pack_product_id text not null,
  pack_amounts jsonb not null check (jsonb_typeof(pack_amounts) = 'object'),
  legal_copy text not null,
  created_at timestamptz not null default now()
);

insert into economy_configs (
  version,
  is_active,
  purchases_killed,
  subscription_grants_killed,
  recovery_grants_killed,
  prediction_placement_killed,
  prediction_settlement_killed,
  starter_grant_coins,
  free_daily_recovery_floor,
  pro_daily_recovery_floor,
  pro_upfront_coins,
  pro_daily_coins,
  pro_service_days,
  standard_stake_coins,
  quick_stake_coins,
  recommended_wallet_fraction,
  max_wallet_fraction,
  absolute_max_stake_coins,
  house_edge,
  min_outcome_probability,
  max_outcome_probability,
  odds_storage_precision,
  odds_display_precision,
  subscription_product_id,
  small_pack_product_id,
  medium_pack_product_id,
  large_pack_product_id,
  pack_amounts,
  legal_copy
) values (
  1,
  false,
  true,
  true,
  true,
  true,
  true,
  2000,
  500,
  1000,
  300,
  40,
  30,
  100,
  array[50, 100, 250],
  0.0500,
  0.1000,
  500,
  0.0500,
  0.1000,
  0.9000,
  4,
  2,
  'pro_monthly_v1',
  'coins_125',
  'coins_750',
  'coins_1650',
  '{"coins_125":125,"coins_750":750,"coins_1650":1650}'::jsonb,
  'Coins are closed-loop entertainment currency with no cash value and cannot be withdrawn, redeemed, transferred, sold, traded, converted to crypto, or used for real-world prizes.'
) on conflict (version) do nothing;

create table if not exists coin_wallets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  currency_type text not null default 'COIN' check (currency_type = 'COIN'),
  economy_config_version integer not null references economy_configs (version),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_type coin_wallet_transaction_type not null,
  signed_amount integer not null check (signed_amount <> 0),
  balance_after integer not null check (balance_after >= 0),
  currency_type text not null default 'COIN' check (currency_type = 'COIN'),
  source_reference text not null,
  idempotency_key text not null,
  economy_config_version integer not null references economy_configs (version),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (idempotency_key)
);

create index if not exists wallet_transactions_user_created_idx on wallet_transactions (user_id, created_at desc);
create index if not exists wallet_transactions_source_idx on wallet_transactions (source_reference);

create table if not exists coin_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('apple', 'google', 'stripe', 'manual_sandbox')),
  purchase_type coin_purchase_type not null,
  product_id text not null,
  provider_transaction_id text not null,
  original_transaction_id text,
  localized_price text,
  currency_code text check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  status coin_purchase_status not null default 'PENDING',
  verified_at timestamptz,
  revoked_at timestamptz,
  verification_reference text,
  verification_payload_hash text,
  economy_config_version integer not null references economy_configs (version),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_transaction_id)
);

create table if not exists pro_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  purchase_id uuid references coin_purchases (id) on delete set null,
  provider text not null,
  product_id text not null,
  status pro_entitlement_status not null,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  service_start_date date not null,
  service_days integer not null check (service_days = 30),
  renewal_at timestamptz,
  cancellation_at timestamptz,
  economy_config_version integer not null references economy_configs (version),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_id)
);

create index if not exists pro_entitlements_user_status_idx on pro_entitlements (user_id, status, expires_at desc);

create table if not exists prediction_market_probability_versions (
  id uuid primary key default gen_random_uuid(),
  rumor_id uuid not null references rumors (id) on delete cascade,
  version integer not null,
  authorized_by uuid references auth.users (id) on delete set null,
  authorized_source text not null check (char_length(authorized_source) between 3 and 120),
  ai_draft jsonb,
  approval_reference text not null,
  house_edge_snapshot numeric(8,4) not null,
  economy_config_version integer not null references economy_configs (version),
  created_at timestamptz not null default now(),
  unique (rumor_id, version)
);

create table if not exists prediction_outcomes (
  id uuid primary key default gen_random_uuid(),
  rumor_id uuid not null references rumors (id) on delete cascade,
  probability_version integer not null,
  outcome_key bet_choice not null,
  label text not null check (char_length(label) between 1 and 80),
  probability numeric(8,4) not null,
  decimal_odds numeric(12,4) not null,
  economy_config_version integer not null references economy_configs (version),
  created_at timestamptz not null default now(),
  unique (rumor_id, probability_version, outcome_key),
  foreign key (rumor_id, probability_version) references prediction_market_probability_versions (rumor_id, version) on delete cascade
);

create table if not exists fixed_prediction_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  market_id uuid not null references rumors (id) on delete cascade,
  outcome_id uuid not null references prediction_outcomes (id),
  legacy_prediction_id uuid references predictions (id) on delete set null,
  stake_coins integer not null check (stake_coins > 0),
  locked_probability numeric(8,4) not null,
  locked_decimal_odds numeric(12,4) not null,
  potential_total_return_coins integer not null check (potential_total_return_coins >= 0),
  potential_net_win_coins integer not null,
  status fixed_prediction_position_status not null default 'OPEN',
  placement_idempotency_key text not null,
  economy_config_version integer not null references economy_configs (version),
  placed_at timestamptz not null default now(),
  settled_at timestamptz,
  settlement_reference text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  unique (placement_idempotency_key),
  unique (user_id, market_id)
);

create index if not exists fixed_prediction_positions_user_placed_idx on fixed_prediction_positions (user_id, placed_at desc);
create index if not exists fixed_prediction_positions_market_status_idx on fixed_prediction_positions (market_id, status);

alter table coin_wallets enable row level security;
alter table wallet_transactions enable row level security;
alter table coin_purchases enable row level security;
alter table pro_entitlements enable row level security;
alter table prediction_market_probability_versions enable row level security;
alter table prediction_outcomes enable row level security;
alter table fixed_prediction_positions enable row level security;

drop policy if exists "read own coin wallet" on coin_wallets;
create policy "read own coin wallet" on coin_wallets for select to authenticated using (user_id = auth.uid());

drop policy if exists "read own wallet transactions" on wallet_transactions;
create policy "read own wallet transactions" on wallet_transactions for select to authenticated using (user_id = auth.uid());

drop policy if exists "read own purchases" on coin_purchases;
create policy "read own purchases" on coin_purchases for select to authenticated using (user_id = auth.uid());

drop policy if exists "read own pro entitlements" on pro_entitlements;
create policy "read own pro entitlements" on pro_entitlements for select to authenticated using (user_id = auth.uid());

drop policy if exists "read published probability versions" on prediction_market_probability_versions;
create policy "read published probability versions" on prediction_market_probability_versions for select to authenticated using (
  exists (select 1 from rumors r where r.id = rumor_id and r.is_draft = false and r.publish_at <= now())
);

drop policy if exists "read published outcomes" on prediction_outcomes;
create policy "read published outcomes" on prediction_outcomes for select to authenticated using (
  exists (select 1 from rumors r where r.id = rumor_id and r.is_draft = false and r.publish_at <= now())
);

drop policy if exists "read own fixed positions" on fixed_prediction_positions;
create policy "read own fixed positions" on fixed_prediction_positions for select to authenticated using (user_id = auth.uid());

create or replace function active_economy_config()
returns economy_configs
language sql
stable
security definer
set search_path = public
as $$
  select * from economy_configs where is_active = true order by version desc limit 1
$$;

create or replace function current_economy_config_for_reads()
returns economy_configs
language sql
stable
security definer
set search_path = public
as $$
  select * from economy_configs order by is_active desc, version desc limit 1
$$;

create or replace function ensure_coin_wallet(p_user_id uuid, p_config_version integer)
returns coin_wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet coin_wallets;
begin
  insert into coin_wallets (user_id, balance, economy_config_version)
  values (p_user_id, 0, p_config_version)
  on conflict (user_id) do nothing;

  select * into v_wallet from coin_wallets where user_id = p_user_id for update;
  return v_wallet;
end;
$$;

create or replace function log_economy_analytics(p_user_id uuid, p_event_name text, p_properties jsonb, p_source text default 'system')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.analytics_events') is not null then
    insert into analytics_events (user_id, event_name, source, properties)
    values (p_user_id, p_event_name, p_source, coalesce(p_properties, '{}'::jsonb));
  end if;
end;
$$;

create or replace function apply_wallet_transaction(
  p_user_id uuid,
  p_transaction_type coin_wallet_transaction_type,
  p_signed_amount integer,
  p_source_reference text,
  p_idempotency_key text,
  p_economy_config_version integer,
  p_metadata jsonb default '{}'::jsonb
)
returns wallet_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing wallet_transactions;
  v_wallet coin_wallets;
  v_after integer;
  v_tx wallet_transactions;
begin
  if p_user_id is null then raise exception 'missing user'; end if;
  if p_signed_amount = 0 then raise exception 'zero wallet transaction'; end if;
  if p_source_reference is null or btrim(p_source_reference) = '' then raise exception 'missing source reference'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'missing idempotency key'; end if;

  select * into v_existing from wallet_transactions where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  v_wallet := ensure_coin_wallet(p_user_id, p_economy_config_version);
  v_after := v_wallet.balance + p_signed_amount;
  if v_after < 0 then
    raise exception 'insufficient coin balance';
  end if;

  update coin_wallets
    set balance = v_after,
        economy_config_version = p_economy_config_version,
        updated_at = now()
    where user_id = p_user_id;

  insert into wallet_transactions (
    user_id,
    transaction_type,
    signed_amount,
    balance_after,
    source_reference,
    idempotency_key,
    economy_config_version,
    metadata
  ) values (
    p_user_id,
    p_transaction_type,
    p_signed_amount,
    v_after,
    p_source_reference,
    p_idempotency_key,
    p_economy_config_version,
    coalesce(p_metadata, '{}'::jsonb)
  ) returning * into v_tx;

  perform log_economy_analytics(
    p_user_id,
    'wallet_transaction_created',
    jsonb_build_object(
      'transactionType', p_transaction_type,
      'signedAmount', p_signed_amount,
      'balanceAfter', v_after,
      'sourceReference', p_source_reference,
      'economyConfigVersion', p_economy_config_version,
      'containsSensitivePaymentInfo', false
    ),
    'system'
  );

  return v_tx;
end;
$$;

create or replace function get_coin_economy_state()
returns table (
  feature_enabled boolean,
  economy_config_version integer,
  balance integer,
  currency_type text,
  is_pro boolean,
  pro_status text,
  pro_expires_at timestamptz,
  next_grant_at timestamptz,
  purchases_killed boolean,
  prediction_placement_killed boolean,
  standard_stake_coins integer,
  quick_stake_coins integer[],
  recommended_wallet_fraction numeric,
  max_wallet_fraction numeric,
  absolute_max_stake_coins integer,
  legal_copy text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_cfg economy_configs;
  v_wallet coin_wallets;
  v_ent pro_entitlements;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_cfg from current_economy_config_for_reads();
  if not found then raise exception 'missing economy config'; end if;

  v_wallet := ensure_coin_wallet(v_user, v_cfg.version);

  select * into v_ent
  from pro_entitlements
  where user_id = v_user
    and status in ('ACTIVE', 'GRACE_PERIOD', 'BILLING_RETRY')
    and expires_at > now()
  order by expires_at desc
  limit 1;

  return query select
    v_cfg.is_active,
    v_cfg.version,
    v_wallet.balance,
    v_wallet.currency_type,
    found,
    case when found then v_ent.status::text else null end,
    case when found then v_ent.expires_at else null end,
    case when found then least((current_date + 1)::timestamptz, v_ent.expires_at) else null end,
    v_cfg.purchases_killed,
    v_cfg.prediction_placement_killed,
    v_cfg.standard_stake_coins,
    v_cfg.quick_stake_coins,
    v_cfg.recommended_wallet_fraction,
    v_cfg.max_wallet_fraction,
    v_cfg.absolute_max_stake_coins,
    v_cfg.legal_copy;
end;
$$;

create or replace function get_wallet_history(p_limit integer default 50, p_before timestamptz default null)
returns table (
  id uuid,
  transaction_type text,
  signed_amount integer,
  balance_after integer,
  currency_type text,
  source_reference text,
  economy_config_version integer,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  return query
  select
    wt.id,
    wt.transaction_type::text,
    wt.signed_amount,
    wt.balance_after,
    wt.currency_type,
    wt.source_reference,
    wt.economy_config_version,
    wt.metadata,
    wt.created_at
  from wallet_transactions wt
  where wt.user_id = v_user
    and (p_before is null or wt.created_at < p_before)
  order by wt.created_at desc
  limit v_limit;
end;
$$;

create or replace function grant_starter_coins()
returns wallet_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_cfg economy_configs;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_cfg from active_economy_config();
  if not found then raise exception 'coin economy disabled'; end if;

  return apply_wallet_transaction(
    v_user,
    'STARTER_GRANT',
    v_cfg.starter_grant_coins,
    'starter:' || v_user::text,
    'starter:' || v_user::text,
    v_cfg.version,
    jsonb_build_object('reason', 'eligible_account_created')
  );
end;
$$;

create or replace function apply_daily_recovery_for_user(p_user_id uuid, p_service_date date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg economy_configs;
  v_wallet coin_wallets;
  v_active_pro boolean;
  v_floor integer;
  v_grant integer;
  v_type coin_wallet_transaction_type;
  v_key text;
begin
  select * into v_cfg from active_economy_config();
  if not found then return 0; end if;
  if v_cfg.recovery_grants_killed then return 0; end if;

  v_wallet := ensure_coin_wallet(p_user_id, v_cfg.version);

  select exists (
    select 1 from pro_entitlements pe
    where pe.user_id = p_user_id
      and pe.status in ('ACTIVE', 'GRACE_PERIOD', 'BILLING_RETRY')
      and p_service_date >= pe.service_start_date
      and p_service_date < pe.service_start_date + pe.service_days
      and pe.expires_at > now()
  ) into v_active_pro;

  if v_active_pro then
    v_floor := v_cfg.pro_daily_recovery_floor;
    v_type := 'PRO_RECOVERY';
    v_key := 'pro_recovery:' || p_user_id::text || ':' || p_service_date::text;
  else
    v_floor := v_cfg.free_daily_recovery_floor;
    v_type := 'FREE_RECOVERY';
    v_key := 'free_recovery:' || p_user_id::text || ':' || p_service_date::text;
  end if;

  v_grant := greatest(v_floor - v_wallet.balance, 0);
  if v_grant <= 0 then return 0; end if;

  perform apply_wallet_transaction(
    p_user_id,
    v_type,
    v_grant,
    v_key,
    v_key,
    v_cfg.version,
    jsonb_build_object('serviceDate', p_service_date, 'floor', v_floor)
  );

  perform log_economy_analytics(
    p_user_id,
    'recovery_floor_applied',
    jsonb_build_object('grantAmount', v_grant, 'floor', v_floor, 'activePro', v_active_pro, 'serviceDate', p_service_date),
    'system'
  );

  return v_grant;
end;
$$;

create or replace function apply_due_pro_grants_for_user(p_user_id uuid, p_through_date date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg economy_configs;
  v_ent pro_entitlements;
  v_date date;
  v_applied integer := 0;
  v_key text;
begin
  select * into v_cfg from active_economy_config();
  if not found then return 0; end if;
  if v_cfg.subscription_grants_killed then return 0; end if;

  for v_ent in
    select * from pro_entitlements
    where user_id = p_user_id
      and status in ('ACTIVE', 'GRACE_PERIOD', 'BILLING_RETRY')
      and service_start_date <= p_through_date
      and expires_at > now()
  loop
    for v_date in
      select generate_series(v_ent.service_start_date, least(p_through_date, v_ent.service_start_date + (v_ent.service_days - 1)), interval '1 day')::date
    loop
      perform apply_daily_recovery_for_user(p_user_id, v_date);
      v_key := 'pro_daily:' || p_user_id::text || ':' || v_ent.id::text || ':' || v_date::text;
      perform apply_wallet_transaction(
        p_user_id,
        'PRO_DAILY',
        v_cfg.pro_daily_coins,
        v_key,
        v_key,
        v_cfg.version,
        jsonb_build_object('serviceDate', v_date, 'entitlementId', v_ent.id)
      );
      v_applied := v_applied + 1;
      perform log_economy_analytics(p_user_id, 'pro_daily_grant_applied', jsonb_build_object('serviceDate', v_date, 'entitlementId', v_ent.id), 'system');
    end loop;
  end loop;

  if v_applied > 0 then
    perform log_economy_analytics(p_user_id, 'pro_grant_reconciled', jsonb_build_object('dailyGrantRowsAttempted', v_applied), 'system');
  end if;

  return v_applied;
exception when unique_violation then
  -- Idempotent transaction keys may already exist during catch-up. Re-run is safe.
  return v_applied;
end;
$$;

create or replace function apply_due_economy_grants(p_limit integer default 500)
returns table (users_checked integer, recovery_grants integer, pro_daily_grants integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user record;
  v_checked integer := 0;
  v_recovery integer := 0;
  v_pro integer := 0;
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 5000));
begin
  for v_user in
    select distinct id as user_id from auth.users order by id limit v_limit
  loop
    v_checked := v_checked + 1;
    v_recovery := v_recovery + apply_daily_recovery_for_user(v_user.user_id, current_date);
    v_pro := v_pro + apply_due_pro_grants_for_user(v_user.user_id, current_date);
  end loop;

  return query select v_checked, v_recovery, v_pro;
end;
$$;

create or replace function service_record_verified_purchase(
  p_user_id uuid,
  p_provider text,
  p_purchase_type coin_purchase_type,
  p_product_id text,
  p_provider_transaction_id text,
  p_original_transaction_id text default null,
  p_localized_price text default null,
  p_currency_code text default null,
  p_verification_reference text default null,
  p_verification_payload_hash text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns coin_purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
  v_cfg economy_configs;
  v_purchase coin_purchases;
  v_pack_coins integer;
  v_ent pro_entitlements;
begin
  if v_role <> 'service_role' then raise exception 'service role required'; end if;

  select * into v_cfg from active_economy_config();
  if not found then raise exception 'coin economy disabled'; end if;
  if v_cfg.purchases_killed then raise exception 'purchases disabled'; end if;

  insert into coin_purchases (
    user_id, provider, purchase_type, product_id, provider_transaction_id,
    original_transaction_id, localized_price, currency_code, status, verified_at,
    verification_reference, verification_payload_hash, economy_config_version, metadata
  ) values (
    p_user_id, p_provider, p_purchase_type, p_product_id, p_provider_transaction_id,
    p_original_transaction_id, p_localized_price, p_currency_code, 'VERIFIED', now(),
    p_verification_reference, p_verification_payload_hash, v_cfg.version,
    coalesce(p_metadata, '{}'::jsonb)
  ) on conflict (provider, provider_transaction_id) do update
    set status = excluded.status,
        verified_at = coalesce(coin_purchases.verified_at, excluded.verified_at),
        updated_at = now()
  returning * into v_purchase;

  perform log_economy_analytics(p_user_id, 'purchase_verified', jsonb_build_object('provider', p_provider, 'purchaseType', p_purchase_type, 'productId', p_product_id, 'localizedPricePresent', p_localized_price is not null, 'containsSensitivePaymentInfo', false), 'system');

  if p_purchase_type = 'COIN_PACK' then
    v_pack_coins := (v_cfg.pack_amounts ->> p_product_id)::integer;
    if v_pack_coins is null or v_pack_coins <= 0 then raise exception 'unknown coin pack product'; end if;

    perform apply_wallet_transaction(
      p_user_id,
      'PACK_PURCHASE',
      v_pack_coins,
      'purchase:' || v_purchase.id::text,
      'purchase:' || p_provider || ':' || p_provider_transaction_id,
      v_cfg.version,
      jsonb_build_object('productId', p_product_id, 'purchaseId', v_purchase.id)
    );
  elsif p_purchase_type = 'SUBSCRIPTION' then
    if p_product_id <> v_cfg.subscription_product_id then raise exception 'unknown subscription product'; end if;

    perform apply_wallet_transaction(
      p_user_id,
      'PRO_UPFRONT',
      v_cfg.pro_upfront_coins,
      'purchase:' || v_purchase.id::text,
      'pro_upfront:' || p_provider || ':' || p_provider_transaction_id,
      v_cfg.version,
      jsonb_build_object('productId', p_product_id, 'purchaseId', v_purchase.id)
    );

    insert into pro_entitlements (
      user_id, purchase_id, provider, product_id, status, starts_at, expires_at,
      service_start_date, service_days, renewal_at, economy_config_version, metadata
    ) values (
      p_user_id, v_purchase.id, p_provider, p_product_id, 'ACTIVE', now(), now() + (v_cfg.pro_service_days || ' days')::interval,
      current_date, v_cfg.pro_service_days, now() + (v_cfg.pro_service_days || ' days')::interval,
      v_cfg.version, jsonb_build_object('source', 'verified_purchase')
    ) on conflict (purchase_id) do update
      set status = 'ACTIVE', expires_at = greatest(pro_entitlements.expires_at, excluded.expires_at), renewal_at = excluded.renewal_at, updated_at = now()
    returning * into v_ent;

    perform log_economy_analytics(p_user_id, 'pro_entitlement_started', jsonb_build_object('entitlementId', v_ent.id, 'expiresAt', v_ent.expires_at), 'system');
    perform log_economy_analytics(p_user_id, 'subscription_started', jsonb_build_object('productId', p_product_id, 'provider', p_provider, 'containsSensitivePaymentInfo', false), 'system');
  end if;

  return v_purchase;
end;
$$;

create or replace function service_update_purchase_status(
  p_provider text,
  p_provider_transaction_id text,
  p_status coin_purchase_status,
  p_reference text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
  v_purchase coin_purchases;
  v_event text;
begin
  if v_role <> 'service_role' then raise exception 'service role required'; end if;

  update coin_purchases
    set status = p_status,
        revoked_at = case when p_status in ('REFUNDED', 'REVOKED') then now() else revoked_at end,
        verification_reference = coalesce(p_reference, verification_reference),
        metadata = coin_purchases.metadata || coalesce(p_metadata, '{}'::jsonb),
        updated_at = now()
    where provider = p_provider and provider_transaction_id = p_provider_transaction_id
    returning * into v_purchase;

  if not found then raise exception 'purchase not found'; end if;

  if p_status in ('REFUNDED', 'REVOKED') then
    update pro_entitlements set status = case when p_status = 'REFUNDED' then 'REFUNDED'::pro_entitlement_status else 'REVOKED'::pro_entitlement_status end, updated_at = now()
    where purchase_id = v_purchase.id;
    v_event := case when p_status = 'REFUNDED' then 'subscription_refunded' else 'subscription_cancelled' end;
    perform log_economy_analytics(v_purchase.user_id, v_event, jsonb_build_object('purchaseId', v_purchase.id, 'productId', v_purchase.product_id, 'containsSensitivePaymentInfo', false), 'system');
  elsif p_status = 'RESTORED' then
    perform log_economy_analytics(v_purchase.user_id, 'purchase_restored', jsonb_build_object('purchaseId', v_purchase.id, 'productId', v_purchase.product_id, 'containsSensitivePaymentInfo', false), 'system');
  end if;
end;
$$;

create or replace function validate_fixed_market_probabilities(p_rumor_id uuid, p_probability_version integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg economy_configs;
  v_count integer;
  v_sum numeric;
  v_bad integer;
begin
  select * into v_cfg from current_economy_config_for_reads();
  if not found then raise exception 'missing economy config'; end if;

  select count(*), coalesce(sum(probability), 0), count(*) filter (where probability is null or probability < v_cfg.min_outcome_probability or probability > v_cfg.max_outcome_probability or probability::text in ('NaN','Infinity','-Infinity'))
  into v_count, v_sum, v_bad
  from prediction_outcomes
  where rumor_id = p_rumor_id and probability_version = p_probability_version;

  if v_count < 2 then raise exception 'market requires at least two outcomes'; end if;
  if v_bad > 0 then raise exception 'invalid outcome probability'; end if;
  if abs(v_sum - 1.0000) > 0.0001 then raise exception 'outcome probabilities must sum to 1.0'; end if;
end;
$$;

create or replace function service_approve_fixed_market_probabilities(
  p_rumor_id uuid,
  p_version integer,
  p_true_probability numeric,
  p_false_probability numeric,
  p_approval_reference text,
  p_authorized_source text,
  p_ai_draft jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
  v_cfg economy_configs;
  v_house numeric;
begin
  if v_role <> 'service_role' then raise exception 'service role required'; end if;

  select * into v_cfg from current_economy_config_for_reads();
  if not found then raise exception 'missing economy config'; end if;
  v_house := v_cfg.house_edge;

  if p_true_probability is null or p_false_probability is null then raise exception 'probabilities required'; end if;
  if p_true_probability < v_cfg.min_outcome_probability or p_true_probability > v_cfg.max_outcome_probability then raise exception 'invalid true probability'; end if;
  if p_false_probability < v_cfg.min_outcome_probability or p_false_probability > v_cfg.max_outcome_probability then raise exception 'invalid false probability'; end if;
  if abs((p_true_probability + p_false_probability) - 1.0000) > 0.0001 then raise exception 'outcome probabilities must sum to 1.0'; end if;

  insert into prediction_market_probability_versions (
    rumor_id, version, authorized_by, authorized_source, ai_draft, approval_reference, house_edge_snapshot, economy_config_version
  ) values (
    p_rumor_id, p_version, auth.uid(), p_authorized_source, p_ai_draft, p_approval_reference, v_house, v_cfg.version
  ) on conflict (rumor_id, version) do update
    set authorized_source = excluded.authorized_source,
        ai_draft = excluded.ai_draft,
        approval_reference = excluded.approval_reference,
        house_edge_snapshot = excluded.house_edge_snapshot,
        economy_config_version = excluded.economy_config_version;

  insert into prediction_outcomes (rumor_id, probability_version, outcome_key, label, probability, decimal_odds, economy_config_version)
  values
    (p_rumor_id, p_version, 'true', 'Verdade', round(p_true_probability, 4), round((1 - v_house) / p_true_probability, 4), v_cfg.version),
    (p_rumor_id, p_version, 'false', 'Mentira', round(p_false_probability, 4), round((1 - v_house) / p_false_probability, 4), v_cfg.version)
  on conflict (rumor_id, probability_version, outcome_key) do update
    set probability = excluded.probability,
        decimal_odds = excluded.decimal_odds,
        economy_config_version = excluded.economy_config_version;

  perform validate_fixed_market_probabilities(p_rumor_id, p_version);
  perform log_economy_analytics(null, 'market_probability_versioned', jsonb_build_object('rumorId', p_rumor_id, 'probabilityVersion', p_version, 'approvalReference', p_approval_reference), 'system');
end;
$$;

create or replace function get_fixed_market_quote(p_rumor_id uuid)
returns table (
  rumor_id uuid,
  probability_version integer,
  outcome_id uuid,
  outcome_key text,
  label text,
  probability numeric,
  decimal_odds numeric,
  economy_config_version integer
)
language sql
stable
security definer
set search_path = public
as $$
  select po.rumor_id, po.probability_version, po.id, po.outcome_key::text, po.label, po.probability, po.decimal_odds, po.economy_config_version
  from prediction_outcomes po
  join (
    select rumor_id, max(version) as version
    from prediction_market_probability_versions
    where rumor_id = p_rumor_id
    group by rumor_id
  ) pv on pv.rumor_id = po.rumor_id and pv.version = po.probability_version
  join rumors r on r.id = po.rumor_id
  where r.is_draft = false
    and r.publish_at <= now()
  order by po.outcome_key;
$$;

create or replace function place_fixed_prediction(
  p_rumor_id uuid,
  p_choice bet_choice,
  p_stake_coins integer,
  p_probability_version integer,
  p_idempotency_key text
)
returns fixed_prediction_positions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_cfg economy_configs;
  v_rumor rumors;
  v_outcome prediction_outcomes;
  v_wallet coin_wallets;
  v_hard_max integer;
  v_return integer;
  v_legacy predictions;
  v_position fixed_prediction_positions;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into v_cfg from active_economy_config();
  if not found then raise exception 'coin economy disabled'; end if;
  if v_cfg.prediction_placement_killed then raise exception 'prediction placement disabled'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'missing idempotency key'; end if;

  select * into v_position from fixed_prediction_positions where placement_idempotency_key = p_idempotency_key;
  if found then return v_position; end if;

  select * into v_rumor from rumors where id = p_rumor_id for update;
  if not found then raise exception 'market not found'; end if;
  if v_rumor.status <> 'speculated' or coalesce(v_rumor.is_draft, false) = true or v_rumor.publish_at > now() then raise exception 'market not open'; end if;
  if v_rumor.prediction_deadline is not null and v_rumor.prediction_deadline <= now() then raise exception 'market locked'; end if;

  select * into v_outcome
  from prediction_outcomes
  where rumor_id = p_rumor_id
    and outcome_key = p_choice
    and probability_version = p_probability_version;
  if not found then raise exception 'invalid outcome or probability version'; end if;

  perform validate_fixed_market_probabilities(p_rumor_id, p_probability_version);

  v_wallet := ensure_coin_wallet(v_user, v_cfg.version);
  v_hard_max := least(v_cfg.absolute_max_stake_coins, floor(v_wallet.balance * v_cfg.max_wallet_fraction)::integer);
  if p_stake_coins <= 0 then raise exception 'invalid stake'; end if;
  if p_stake_coins > v_wallet.balance then raise exception 'insufficient coin balance'; end if;
  if p_stake_coins > v_hard_max then raise exception 'stake exceeds bankroll limit'; end if;

  v_return := floor(p_stake_coins * v_outcome.decimal_odds);

  perform apply_wallet_transaction(
    v_user,
    'PREDICTION_STAKE',
    -p_stake_coins,
    'fixed_prediction:' || p_idempotency_key,
    'stake:' || p_idempotency_key,
    v_cfg.version,
    jsonb_build_object('rumorId', p_rumor_id, 'choice', p_choice, 'probabilityVersion', p_probability_version)
  );

  -- Preserve existing app semantics by also creating the legacy prediction row/counter inside this transaction.
  with updated_rumor as (
    update rumors
    set
      true_votes = true_votes + (case when p_choice = 'true' then 1 else 0 end),
      false_votes = false_votes + (case when p_choice = 'false' then 1 else 0 end)
    where id = p_rumor_id
      and status = 'speculated'
      and publish_at <= now()
      and coalesce(is_draft, false) = false
    returning
      id,
      seed_true,
      seed_false,
      true_votes - (case when p_choice = 'true' then 1 else 0 end) as previous_true_votes,
      false_votes - (case when p_choice = 'false' then 1 else 0 end) as previous_false_votes
  )
  insert into predictions (user_id, rumor_id, choice, crowd_true_at_cast, crowd_false_at_cast)
  select v_user, id, p_choice, seed_true + previous_true_votes, seed_false + previous_false_votes
  from updated_rumor
  returning * into v_legacy;

  insert into fixed_prediction_positions (
    user_id,
    market_id,
    outcome_id,
    legacy_prediction_id,
    stake_coins,
    locked_probability,
    locked_decimal_odds,
    potential_total_return_coins,
    potential_net_win_coins,
    status,
    placement_idempotency_key,
    economy_config_version,
    metadata
  ) values (
    v_user,
    p_rumor_id,
    v_outcome.id,
    v_legacy.id,
    p_stake_coins,
    v_outcome.probability,
    v_outcome.decimal_odds,
    v_return,
    v_return - p_stake_coins,
    'OPEN',
    p_idempotency_key,
    v_cfg.version,
    jsonb_build_object('remainingBalanceAfterStake', v_wallet.balance - p_stake_coins)
  ) returning * into v_position;

  perform log_economy_analytics(v_user, 'prediction_placed', jsonb_build_object('positionId', v_position.id, 'rumorId', p_rumor_id, 'stakeCoins', p_stake_coins, 'lockedDecimalOdds', v_outcome.decimal_odds, 'potentialTotalReturnCoins', v_return), 'system');

  return v_position;
exception when unique_violation then
  select * into v_position from fixed_prediction_positions where placement_idempotency_key = p_idempotency_key or (user_id = v_user and market_id = p_rumor_id);
  if found then return v_position; end if;
  raise;
end;
$$;

create or replace function settle_fixed_prediction_market(
  p_rumor_id uuid,
  p_winning_choice bet_choice,
  p_void boolean default false,
  p_settlement_reference text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
  v_cfg economy_configs;
  v_position fixed_prediction_positions;
  v_count integer := 0;
  v_status fixed_prediction_position_status;
  v_credit integer;
  v_reference text := coalesce(nullif(btrim(p_settlement_reference), ''), 'settlement:' || p_rumor_id::text || ':' || now()::text);
begin
  if v_role <> 'service_role' then raise exception 'service role required'; end if;
  select * into v_cfg from active_economy_config();
  if not found then raise exception 'coin economy disabled'; end if;
  if v_cfg.prediction_settlement_killed then raise exception 'prediction settlement disabled'; end if;

  for v_position in
    select * from fixed_prediction_positions
    where market_id = p_rumor_id and status = 'OPEN'
    for update
  loop
    if p_void then
      v_status := 'VOID';
      v_credit := v_position.stake_coins;
    elsif exists (select 1 from prediction_outcomes po where po.id = v_position.outcome_id and po.outcome_key = p_winning_choice) then
      v_status := 'WON';
      v_credit := floor(v_position.stake_coins * v_position.locked_decimal_odds);
    else
      v_status := 'LOST';
      v_credit := 0;
    end if;

    update fixed_prediction_positions
      set status = v_status,
          settled_at = now(),
          settlement_reference = v_reference
      where id = v_position.id;

    if v_status = 'WON' then
      perform apply_wallet_transaction(
        v_position.user_id,
        'PREDICTION_WIN_RETURN',
        v_credit,
        v_reference,
        'settle_win:' || v_position.id::text,
        v_position.economy_config_version,
        jsonb_build_object('positionId', v_position.id, 'marketId', p_rumor_id)
      );
      perform log_economy_analytics(v_position.user_id, 'prediction_settled', jsonb_build_object('positionId', v_position.id, 'status', v_status, 'credit', v_credit), 'system');
    elsif v_status = 'VOID' then
      perform apply_wallet_transaction(
        v_position.user_id,
        'PREDICTION_VOID_REFUND',
        v_credit,
        v_reference,
        'settle_void:' || v_position.id::text,
        v_position.economy_config_version,
        jsonb_build_object('positionId', v_position.id, 'marketId', p_rumor_id)
      );
      perform log_economy_analytics(v_position.user_id, 'prediction_voided', jsonb_build_object('positionId', v_position.id, 'credit', v_credit), 'system');
    else
      perform log_economy_analytics(v_position.user_id, 'prediction_settled', jsonb_build_object('positionId', v_position.id, 'status', v_status, 'credit', 0), 'system');
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function active_economy_config() from public;
revoke all on function current_economy_config_for_reads() from public;
revoke all on function ensure_coin_wallet(uuid, integer) from public;
revoke all on function log_economy_analytics(uuid, text, jsonb, text) from public;
revoke all on function apply_wallet_transaction(uuid, coin_wallet_transaction_type, integer, text, text, integer, jsonb) from public;
revoke all on function apply_daily_recovery_for_user(uuid, date) from public;
revoke all on function apply_due_pro_grants_for_user(uuid, date) from public;
revoke all on function apply_due_economy_grants(integer) from public;
revoke all on function service_record_verified_purchase(uuid, text, coin_purchase_type, text, text, text, text, text, text, text, jsonb) from public;
revoke all on function service_update_purchase_status(text, text, coin_purchase_status, text, jsonb) from public;
revoke all on function service_approve_fixed_market_probabilities(uuid, integer, numeric, numeric, text, text, jsonb) from public;
revoke all on function settle_fixed_prediction_market(uuid, bet_choice, boolean, text) from public;

grant execute on function get_coin_economy_state() to authenticated;
grant execute on function get_wallet_history(integer, timestamptz) to authenticated;
grant execute on function grant_starter_coins() to authenticated;
grant execute on function get_fixed_market_quote(uuid) to authenticated;
grant execute on function place_fixed_prediction(uuid, bet_choice, integer, integer, text) to authenticated;

grant execute on function apply_due_economy_grants(integer) to service_role;
grant execute on function service_record_verified_purchase(uuid, text, coin_purchase_type, text, text, text, text, text, text, text, jsonb) to service_role;
grant execute on function service_update_purchase_status(text, text, coin_purchase_status, text, jsonb) to service_role;
grant execute on function service_approve_fixed_market_probabilities(uuid, integer, numeric, numeric, text, text, jsonb) to service_role;
grant execute on function settle_fixed_prediction_market(uuid, bet_choice, boolean, text) to service_role;
