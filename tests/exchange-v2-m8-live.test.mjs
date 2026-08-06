import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const ENV_PATH = `${process.env.HOME ?? ''}/.config/viddi/supabase.env`;

function loadLocalEnvFile() {
  if (!existsSync(ENV_PATH)) return;
  const text = readFileSync(ENV_PATH, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

loadLocalEnvFile();

const shouldRunLive = process.env.RUN_EXCHANGE_V2_M8_LIVE === 'true';
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasLiveConfig = Boolean(supabaseUrl && anonKey && serviceRoleKey);
const maybeTest = shouldRunLive && hasLiveConfig ? test : test.skip;

function client(key) {
  return createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function rpc(supabase, name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`${name} failed: ${error.message}`);
  return data;
}

async function rows(supabase, table, query) {
  const { data, error } = await query(supabase.from(table));
  if (error) throw new Error(`${table} query failed: ${error.message}`);
  return data ?? [];
}

async function single(supabase, table, query) {
  const { data, error } = await query(supabase.from(table)).single();
  if (error) throw new Error(`${table} single failed: ${error.message}`);
  return data;
}

async function assertProductionGateFalse(service, label) {
  const prod = await single(service, 'exchange_feature_gates', (q) =>
    q.select('environment,trading_enabled,selling_enabled,market_maker_enabled,production_approved')
      .eq('environment', 'production')
  );
  assert.equal(prod.environment, 'production', label);
  assert.equal(prod.production_approved, false, `${label}: production approval must stay false`);
  assert.equal(prod.trading_enabled, false, `${label}: production trading must stay disabled`);
  assert.equal(prod.selling_enabled, false, `${label}: production selling must stay disabled`);
  assert.equal(prod.market_maker_enabled, false, `${label}: production market maker must stay disabled`);
}

async function createSignedInTestUser(service, label) {
  const email = `m8-${label}-${Date.now()}-${randomUUID()}@viddi.test`;
  const password = `M8-${randomUUID()}-aA1!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(`create ${label} user failed: ${created.error.message}`);

  const authed = client(anonKey);
  const signedIn = await authed.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`sign in ${label} user failed: ${signedIn.error.message}`);
  return { id: created.data.user.id, email, client: authed };
}

async function placeOrder(userClient, { marketId, outcome, action, quantity = '100.000000', price, clientOrderId }) {
  const quote = await rpc(userClient, 'quote_order_v2', {
    p_market_id: marketId,
    p_outcome: outcome,
    p_action: action,
    p_quantity: quantity,
    p_limit_price: price,
  });
  assert.equal(String(quote.marketId), marketId);
  assert.equal(quote.action, action);
  assert.equal(quote.outcome, outcome);
  assert.equal(Number(quote.requestedQuantity), Number(quantity));

  return rpc(userClient, 'place_order_v2', {
    p_market_id: marketId,
    p_outcome: outcome,
    p_action: action,
    p_quantity: quantity,
    p_limit_price: price,
    p_time_in_force: 'GTC',
    p_client_order_id: clientOrderId,
    p_quote_id: quote.quoteId,
    p_environment: 'development',
    p_expires_at: null,
  });
}

async function getWalletBalances(service, users) {
  const wallets = await rows(service, 'coin_wallets', (q) =>
    q.select('user_id,balance').in('user_id', users.map((u) => u.id))
  );
  return Object.fromEntries(wallets.map((wallet) => [wallet.user_id, Number(wallet.balance)]));
}

async function seedRumorAndMarket(service, suffix) {
  const inserted = await single(service, 'rumors', (q) =>
    q.insert({
      summary: `M8 live exchange lifecycle test ${suffix}: atriz teria confirmado novo projeto`,
      status: 'speculated',
      is_hero: false,
      source_url: 'https://g1.globo.com/rss/g1/pop-arte/',
      source_label: 'M8 live test',
      is_draft: false,
    }).select('id').single()
  );

  const closeAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const resolveByAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const promoted = await rpc(service, 'promote_rumor_to_exchange_market_v2', {
    p_rumor_id: inserted.id,
    p_close_at: closeAt,
    p_resolve_by_at: resolveByAt,
    p_resolution_policy: 'evidence',
    p_required_source_count: 1,
    p_tick_size: '0.01000000',
    p_quantity_step: '1.000000',
    p_min_order_quantity: '100.000000',
    p_opening_mark_price: '0.50000000',
    p_fee_bps: 0,
  });
  assert.equal(promoted.marketId, inserted.id);
  assert.equal(promoted.state, 'draft');

  const opened = await rpc(service, 'open_exchange_market_v2', { p_market_id: inserted.id });
  assert.equal(opened.state, 'open');
  return inserted.id;
}

async function runMint(service, marketId, trueUser, falseUser, suffix) {
  const trueBuy = await placeOrder(trueUser.client, {
    marketId,
    outcome: 'true',
    action: 'buy',
    price: '0.40000000',
    clientOrderId: `m8-${suffix}-true-buy-${randomUUID()}`,
  });
  assert.equal(trueBuy.status, 'open');
  assert.equal(Number(trueBuy.reservedCollateral), 40);

  const falseBuy = await placeOrder(falseUser.client, {
    marketId,
    outcome: 'false',
    action: 'buy',
    price: '0.60000000',
    clientOrderId: `m8-${suffix}-false-buy-${randomUUID()}`,
  });
  assert.equal(falseBuy.status, 'filled');
  assert.equal(Number(falseBuy.filledQuantity), 100);
  assert.equal(Number(falseBuy.reservedCollateral), 60);

  const positions = await rows(service, 'exchange_positions', (q) =>
    q.select('user_id,outcome,quantity,cost_basis,average_entry_price,reserved_sell_quantity')
      .eq('market_id', marketId)
      .order('outcome')
  );
  const truePosition = positions.find((p) => p.user_id === trueUser.id && p.outcome === 'true');
  const falsePosition = positions.find((p) => p.user_id === falseUser.id && p.outcome === 'false');
  assert.equal(Number(truePosition?.quantity), 100);
  assert.equal(Number(truePosition?.cost_basis), 40);
  assert.equal(Number(falsePosition?.quantity), 100);
  assert.equal(Number(falsePosition?.cost_basis), 60);

  const mints = await rows(service, 'exchange_audit_events', (q) =>
    q.select('event_type,metadata').eq('aggregate_id', marketId).eq('event_type', 'exchange_complete_set_minted')
  );
  assert.equal(mints.length, 1);
  assert.equal(Number(mints[0].metadata.totalCollateralCoins), 100);
  assert.equal(mints[0].metadata.settlementInvariant, 'exactly_one_side_pays_1_coin');
}

maybeTest('M8 live dev-gated exchange lifecycle conserves the whole-coin economy and never touches production gate', async () => {
  const service = client(serviceRoleKey);
  const users = [];
  const rumorIds = [];
  let originalDevGate = null;

  try {
    await assertProductionGateFalse(service, 'before M8 setup');
    originalDevGate = await single(service, 'exchange_feature_gates', (q) =>
      q.select('trading_enabled,selling_enabled,market_maker_enabled,fees_enabled,production_approved')
        .eq('environment', 'development')
    );
    assert.equal(originalDevGate.production_approved, false, 'development gate must not claim production approval');

    const gateUpdate = await service.from('exchange_feature_gates')
      .update({ trading_enabled: true, selling_enabled: true, market_maker_enabled: false, fees_enabled: false })
      .eq('environment', 'development')
      .select('environment,trading_enabled,selling_enabled,market_maker_enabled,fees_enabled,production_approved')
      .single();
    if (gateUpdate.error) throw new Error(`development gate update failed: ${gateUpdate.error.message}`);
    assert.equal(gateUpdate.data.environment, 'development');
    assert.equal(gateUpdate.data.production_approved, false);
    await assertProductionGateFalse(service, 'after development gate enable');

    const traderTrue = await createSignedInTestUser(service, 'true');
    const traderFalse = await createSignedInTestUser(service, 'false');
    users.push(traderTrue, traderFalse);

    const walletSeed = await service.from('coin_wallets').upsert(
      users.map((u) => ({ user_id: u.id, balance: 1000, economy_config_version: 1 })),
      { onConflict: 'user_id' }
    );
    if (walletSeed.error) throw new Error(`wallet seed failed: ${walletSeed.error.message}`);
    const initialBalances = await getWalletBalances(service, users);
    assert.deepEqual(initialBalances, { [traderTrue.id]: 1000, [traderFalse.id]: 1000 });

    const marketId = await seedRumorAndMarket(service, 'TEA');
    rumorIds.push(marketId);
    await assertProductionGateFalse(service, 'after market open');

    await runMint(service, marketId, traderTrue, traderFalse, 'tea');
    let balances = await getWalletBalances(service, users);
    assert.equal(balances[traderTrue.id], 960, 'true buyer reserved 40 whole coins for mint');
    assert.equal(balances[traderFalse.id], 940, 'false buyer reserved 60 whole coins for mint');

    const restingBuy = await placeOrder(traderFalse.client, {
      marketId,
      outcome: 'true',
      action: 'buy',
      price: '0.50000000',
      clientOrderId: `m8-tea-same-outcome-buy-${randomUUID()}`,
    });
    assert.equal(restingBuy.status, 'open');
    assert.equal(Number(restingBuy.reservedCollateral), 50);

    const cashOutSell = await placeOrder(traderTrue.client, {
      marketId,
      outcome: 'true',
      action: 'sell',
      price: '0.50000000',
      clientOrderId: `m8-tea-cashout-sell-${randomUUID()}`,
    });
    assert.equal(cashOutSell.status, 'filled');
    assert.equal(Number(cashOutSell.filledQuantity), 100);
    await assertProductionGateFalse(service, 'after same-outcome cash-out sell');

    balances = await getWalletBalances(service, users);
    assert.equal(balances[traderTrue.id], 1010, 'seller cash-out credited 50 whole coins after 40-coin mint cost');
    assert.equal(balances[traderFalse.id], 890, 'buyer paid another 50 whole coins into the book');

    const fills = await rows(service, 'exchange_fills', (q) =>
      q.select('outcome,quantity,price').eq('market_id', marketId).order('created_at')
    );
    assert.equal(fills.length, 3, 'two complete-set fill rows plus one same-outcome trade');
    assert.equal(fills.filter((fill) => fill.outcome === 'true').length, 2);
    assert.equal(fills.filter((fill) => fill.outcome === 'false').length, 1);

    const settlement = await rpc(service, 'resolve_market_v2', {
      p_market_id: marketId,
      p_outcome: 'true',
      p_reference: 'M8 development test TEA settlement',
      p_idempotency_key: `m8-tea-settlement-${randomUUID()}`,
    });
    assert.equal(settlement.outcome, 'true');
    assert.equal(Number(settlement.trueValue), 1);
    assert.equal(Number(settlement.falseValue), 0);
    assert.equal(Number(settlement.totalPayoutCoins), 100);

    balances = await getWalletBalances(service, users);
    assert.equal(balances[traderTrue.id], 1010, 'seller has realized +10 whole-coin PnL after TEA settlement');
    assert.equal(balances[traderFalse.id], 990, 'buyer has realized -10 whole-coin PnL after TEA settlement');
    assert.equal(balances[traderTrue.id] + balances[traderFalse.id], 2000, 'TEA scenario conserves total whole coins');

    const bridgeTransactions = await rows(service, 'wallet_transactions', (q) =>
      q.select('user_id,signed_amount,source_reference,metadata')
        .in('user_id', users.map((u) => u.id))
        .like('source_reference', 'exchange_v2:%')
    );
    assert.ok(bridgeTransactions.length >= 5, '0056 bridge wrote exchange_v2 wallet transactions');
    assert.ok(bridgeTransactions.every((tx) => Number.isInteger(Number(tx.signed_amount))));
    assert.ok(bridgeTransactions.every((tx) => tx.metadata?.engineVersion === 'exchange_v2'));

    const ledgerCoins = await rows(service, 'exchange_wallet_ledger', (q) =>
      q.select('entry_type,amount,currency,metadata').eq('market_id', marketId).eq('currency', 'COIN')
    );
    assert.ok(ledgerCoins.every((entry) => Number(entry.amount) === Math.trunc(Number(entry.amount))));
    assert.ok(ledgerCoins.every((entry) => entry.metadata?.legacyFixedOddsTouched === false));

    const voidTrue = await createSignedInTestUser(service, 'void-true');
    const voidFalse = await createSignedInTestUser(service, 'void-false');
    users.push(voidTrue, voidFalse);
    const voidWalletSeed = await service.from('coin_wallets').upsert(
      [voidTrue, voidFalse].map((u) => ({ user_id: u.id, balance: 1000, economy_config_version: 1 })),
      { onConflict: 'user_id' }
    );
    if (voidWalletSeed.error) throw new Error(`void wallet seed failed: ${voidWalletSeed.error.message}`);

    const voidMarketId = await seedRumorAndMarket(service, 'VOID');
    rumorIds.push(voidMarketId);
    await runMint(service, voidMarketId, voidTrue, voidFalse, 'void');
    const voidSettlement = await rpc(service, 'resolve_market_v2', {
      p_market_id: voidMarketId,
      p_outcome: 'void',
      p_reference: 'M8 development test VOID settlement',
      p_idempotency_key: `m8-void-settlement-${randomUUID()}`,
    });
    assert.equal(voidSettlement.outcome, 'void');
    assert.equal(Number(voidSettlement.trueValue), 0.5);
    assert.equal(Number(voidSettlement.falseValue), 0.5);
    assert.equal(Number(voidSettlement.totalPayoutCoins), 100);

    const voidBalances = await getWalletBalances(service, [voidTrue, voidFalse]);
    assert.equal(voidBalances[voidTrue.id], 1010, 'VOID true side receives 0.5/share from a 0.4 entry');
    assert.equal(voidBalances[voidFalse.id], 990, 'VOID false side receives 0.5/share from a 0.6 entry');
    assert.equal(voidBalances[voidTrue.id] + voidBalances[voidFalse.id], 2000, 'VOID scenario conserves total whole coins');

    await assertProductionGateFalse(service, 'after all M8 lifecycle assertions');
  } finally {
    if (originalDevGate) {
      await service.from('exchange_feature_gates')
        .update({
          trading_enabled: originalDevGate.trading_enabled,
          selling_enabled: originalDevGate.selling_enabled,
          market_maker_enabled: originalDevGate.market_maker_enabled,
          fees_enabled: originalDevGate.fees_enabled,
          production_approved: false,
        })
        .eq('environment', 'development');
    }
    for (const rumorId of rumorIds.reverse()) {
      await service.from('rumors').delete().eq('id', rumorId);
    }
    for (const user of users.reverse()) {
      await service.auth.admin.deleteUser(user.id);
    }
  }
});
