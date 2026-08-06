-- 0056_exchange_v2_coin_wallet_integration.sql — exchange-v2 real coin wallet integration
--
-- CODE-READY / HUMAN-GATED:
-- - Chris applies migrations manually; Hermes must not apply this file.
-- - Production trading remains disabled. This migration does not update the
--   production exchange_feature_gates row and does not enable any gate.
-- - Coins remain closed-loop entertainment currency: no cash value, no
--   withdrawal, no redemption, no transfers, no prizes, no crypto conversion.
-- - Legacy fixed-odds tables/positions are not reinterpreted or mutated.
--
-- M6:
-- - exchange_wallet_ledger COIN entries become the authoritative bridge into
--   the real integer coin_wallets balance via wallet_transactions.
-- - reserve_coin debits spendable balance immediately, so open orders hold real
--   wallet coins instead of only shadow-reserving them.
-- - spend_coin is ledger-only because the reserve already debited spendable
--   coins; consuming a reservation must not double-debit the real wallet.
-- - release_coin, credit_coin, and settlement credit spendable balance.
-- - Every wallet side effect is idempotent from the exchange ledger key.
-- - Whole-coin strictness is enforced at the bridge until the exchange tick /
--   quantity model explicitly supports fractional wallet coins.

create or replace function exchange_available_coin_balance(p_user_id uuid)
returns numeric
language sql
stable
as $$
  -- M6: active COIN reservations already debit coin_wallets.balance through
  -- wallet_transactions, so the spendable exchange balance is the real wallet
  -- balance. Do not subtract exchange_active_coin_reserved() again.
  select exchange_coin_wallet_balance(p_user_id);
$$;

create or replace function exchange_wallet_transaction_type_for_entry_v2(
  p_entry_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns coin_wallet_transaction_type
language sql
immutable
as $$
  select case
    when p_entry_type in ('reserve_coin', 'spend_coin') then 'PREDICTION_STAKE'::coin_wallet_transaction_type
    when p_entry_type = 'settlement' and coalesce(p_metadata->>'settlementOutcome', '') = 'void' then 'PREDICTION_VOID_REFUND'::coin_wallet_transaction_type
    when p_entry_type = 'release_coin' then 'PREDICTION_VOID_REFUND'::coin_wallet_transaction_type
    when p_entry_type in ('credit_coin', 'settlement') then 'PREDICTION_WIN_RETURN'::coin_wallet_transaction_type
    else 'ADMIN_ADJUSTMENT'::coin_wallet_transaction_type
  end;
$$;

create or replace function exchange_wallet_signed_amount_for_entry_v2(
  p_entry_type text,
  p_amount numeric
)
returns integer
language plpgsql
immutable
as $$
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'invalid exchange wallet amount';
  end if;

  if p_amount <> trunc(p_amount) then
    raise exception 'exchange wallet bridge requires whole-coin amounts';
  end if;

  if p_entry_type = 'reserve_coin' then
    return (p_amount * -1)::integer;
  elsif p_entry_type in ('release_coin', 'credit_coin', 'settlement') then
    return p_amount::integer;
  elsif p_entry_type = 'spend_coin' then
    -- Reserve already removed spendable balance. Spend consumes the held
    -- reservation and remains exchange-ledger-only to avoid a double debit.
    return 0;
  end if;

  return 0;
end;
$$;

create or replace function exchange_apply_coin_wallet_ledger_entry_v2()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg economy_configs;
  v_signed_amount integer;
  v_tx wallet_transactions;
  v_source_reference text;
  v_wallet_idempotency_key text;
begin
  if new.currency <> 'COIN' or new.entry_type not in ('reserve_coin', 'spend_coin', 'release_coin', 'credit_coin', 'settlement') then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'realCoinWalletApplied', false,
      'realCoinWalletApplyReason', 'non_coin_or_non_wallet_entry'
    );
    return new;
  end if;

  if new.user_id is null then
    raise exception 'exchange wallet COIN entry missing user';
  end if;

  v_signed_amount := exchange_wallet_signed_amount_for_entry_v2(new.entry_type, new.amount);

  if v_signed_amount = 0 then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'realCoinWalletApplied', false,
      'realCoinWalletApplyReason', 'reserve_already_debited_or_zero_amount',
      'legacyFixedOddsTouched', false,
      'coinsClosedLoop', true
    );
    return new;
  end if;

  select * into v_cfg from current_economy_config_for_reads();
  if not found then
    raise exception 'missing economy config';
  end if;

  v_source_reference := 'exchange_v2:' || new.idempotency_key;
  v_wallet_idempotency_key := 'exchange_wallet_bridge:' || new.idempotency_key;

  v_tx := apply_wallet_transaction(
    new.user_id,
    exchange_wallet_transaction_type_for_entry_v2(new.entry_type, new.metadata),
    v_signed_amount,
    v_source_reference,
    v_wallet_idempotency_key,
    v_cfg.version,
    jsonb_build_object(
      'engineVersion', 'exchange_v2',
      'exchangeLedgerIdempotencyKey', new.idempotency_key,
      'exchangeEntryType', new.entry_type,
      'exchangeAmount', new.amount,
      'marketId', new.market_id,
      'orderId', new.order_id,
      'fillId', new.fill_id,
      'settlementId', new.settlement_id,
      'legacyFixedOddsTouched', false,
      'coinsClosedLoop', true
    ) || coalesce(new.metadata, '{}'::jsonb)
  );

  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'realCoinWalletApplied', true,
    'walletTransactionId', v_tx.id,
    'walletSignedAmount', v_signed_amount,
    'walletBalanceAfter', v_tx.balance_after,
    'walletIdempotencyKey', v_wallet_idempotency_key,
    'legacyFixedOddsTouched', false,
    'coinsClosedLoop', true
  );

  return new;
end;
$$;

drop trigger if exists exchange_apply_coin_wallet_ledger_entry_v2_trigger on exchange_wallet_ledger;
create trigger exchange_apply_coin_wallet_ledger_entry_v2_trigger
  before insert on exchange_wallet_ledger
  for each row
  execute function exchange_apply_coin_wallet_ledger_entry_v2();

create or replace function exchange_coin_wallet_bridge_health_v2(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'userId', p_user_id,
    'realWalletBalance', exchange_coin_wallet_balance(p_user_id),
    'spendableExchangeBalance', exchange_available_coin_balance(p_user_id),
    'activeCoinReservations', exchange_active_coin_reserved(p_user_id),
    'bridgeMode', 'reserve-debits-real-wallet',
    'legacyFixedOddsTouched', false,
    'coinsClosedLoop', true
  );
$$;

revoke all on function exchange_wallet_transaction_type_for_entry_v2(text, jsonb) from public, anon, authenticated;
revoke all on function exchange_wallet_signed_amount_for_entry_v2(text, numeric) from public, anon, authenticated;
revoke all on function exchange_apply_coin_wallet_ledger_entry_v2() from public, anon, authenticated;
revoke all on function exchange_coin_wallet_bridge_health_v2(uuid) from public, anon;
grant execute on function exchange_coin_wallet_bridge_health_v2(uuid) to authenticated, service_role;
