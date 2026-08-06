import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';

const migration = readFileSync(new URL('../supabase/migrations/0065_exchange_v2_lmsr_house_amm.sql', import.meta.url), 'utf8');
const clientSource = readFileSync(new URL('../src/lib/exchangeV2.ts', import.meta.url), 'utf8');
const ENV_PATH = `${process.env.HOME ?? ''}/.config/viddi/supabase.env`;

function has(pattern, source = migration) {
  assert.match(source, pattern);
}

function lmsrState({ qYes, qNo, b0 = 2000, alpha = 0.05 }) {
  const b = b0 + alpha * (qYes + qNo);
  const aYes = qYes / b;
  const aNo = qNo / b;
  const m = Math.max(aYes, aNo);
  const eYes = Math.exp(aYes - m);
  const eNo = Math.exp(aNo - m);
  const sum = eYes + eNo;
  const logSum = m + Math.log(sum);
  const piYes = eYes / sum;
  const piNo = eNo / sum;
  const weightedQ = qYes * piYes + qNo * piNo;
  const rawPriceYes = piYes + alpha * logSum - (alpha / b) * weightedQ;
  const rawPriceNo = piNo + alpha * logSum - (alpha / b) * weightedQ;
  const rawPriceSum = rawPriceYes + rawPriceNo;
  return {
    b,
    cost: b * logSum,
    rawPriceYes,
    rawPriceNo,
    rawPriceSum,
    normalizedPriceYes: rawPriceYes / rawPriceSum,
  };
}

function seedQYes(p, b0 = 2000) {
  return b0 * Math.log(p / (1 - p));
}

function buyQuote(state, quantity) {
  const before = lmsrState(state);
  const after = lmsrState({ ...state, qYes: state.qYes + quantity });
  return { before, after, cost: after.cost - before.cost, roundedCoins: Math.ceil(after.cost - before.cost) };
}

function houseNetCoinMint(rows) {
  return rows.reduce((sum, row) => {
    if (row.currency !== 'COIN') return sum;
    if (row.entry_type === 'sell_to_house' || row.entry_type === 'settlement_marker') return sum + Number(row.amount);
    if (row.entry_type === 'buy_from_house') return sum - Number(row.amount);
    return sum;
  }, 0);
}

function settlementExposure(rows, outcome) {
  const exposure = rows.reduce((sum, row) => {
    if (!['buy_from_house', 'sell_to_house'].includes(row.entry_type)) return sum;
    const sign = row.entry_type === 'buy_from_house' ? 1 : -1;
    const quantity = Number(row.metadata?.quantity ?? 0);
    const value = outcome === 'void' ? 0.5 : row.metadata?.outcome === outcome ? 1 : 0;
    return sum + sign * quantity * value;
  }, 0);
  return Math.max(exposure, 0);
}

function loadLocalEnvFile() {
  if (!existsSync(ENV_PATH)) return;
  const text = readFileSync(ENV_PATH, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] ??= value;
  }
}

loadLocalEnvFile();
const shouldRunLive = process.env.RUN_EXCHANGE_V2_0065_LIVE === 'true';
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
  assert.equal(prod.trading_enabled, false, `${label}: production trading must stay disabled`);
  assert.equal(prod.selling_enabled, false, `${label}: production selling must stay disabled`);
  assert.equal(prod.market_maker_enabled, false, `${label}: production market maker must stay disabled`);
  assert.equal(prod.production_approved, false, `${label}: production approval must stay false`);
}

test('0065 adds additive AMM data model without touching production gates or legacy fixed odds', () => {
  for (const column of ['amm_enabled', 'amm_b0', 'amm_alpha', 'amm_max_house_mint_coins', 'amm_q_yes', 'amm_q_no']) {
    has(new RegExp(`add\\s+column\\s+if\\s+not\\s+exists\\s+${column}`, 'i'));
  }
  has(/create\s+table\s+if\s+not\s+exists\s+exchange_amm_house_accounts/i);
  has(/create\s+table\s+if\s+not\s+exists\s+exchange_amm_house_ledger/i);
  assert.doesNotMatch(migration, /update\s+exchange_feature_gates/i);
  assert.doesNotMatch(migration, /fixed_prediction_positions|legacy_fixed_odds[^\n]*update/i);
  has(/legacyFixedOddsTouched',\s*false/i);
  has(/coinsClosedLoop',\s*true/i);
});

test('0065 implements canonical liquidity-sensitive LMSR equations with log-sum-exp', () => {
  has(/b\(q\)=b0\+alpha\*sum\(q\)/i);
  has(/A Practical Liquidity-Sensitive Automated Market Maker/i);
  has(/v_m\s+numeric\s*:=\s*greatest\(v_a_yes,\s*v_a_no\)/i);
  has(/exp\(v_a_yes\s*-\s*v_m\)/i);
  has(/v_cost\s*:=\s*v_b\s*\*\s*v_log_sum/i);
  has(/v_raw_yes\s*:=\s*v_pi_yes\s*\+\s*p_alpha\s*\*\s*v_log_sum\s*-\s*\(p_alpha\s*\/\s*v_b\)\s*\*\s*v_weighted_q/i);
});

test('0065 seeds opening AMM price from crowd TEA mark and uses v1 defaults', () => {
  has(/p_b0\s+numeric\s+default\s+2000\.000000/i);
  has(/p_alpha\s+numeric\s+default\s+0\.05000000/i);
  has(/exchange_lmsr_seed_q_yes_v2\(v_opening_mark,\s*p_b0\)/i);
  has(/p_b0\s*\*\s*ln\(v_p\s*\/\s*\(1\s*-\s*v_p\)\)/i);

  const qYes = seedQYes(0.38);
  const seeded = lmsrState({ qYes, qNo: 0 });
  assert.ok(Math.abs(seeded.normalizedPriceYes - 0.38) <= 0.01, `seeded normalized price ${seeded.normalizedPriceYes}`);
  assert.ok(seeded.rawPriceSum > 1.06 && seeded.rawPriceSum < 1.08, `binary overround ${seeded.rawPriceSum}`);
});

test('0065 quotes and executes AMM beside the existing CLOB quote/order path', () => {
  has(/create\s+or\s+replace\s+function\s+quote_amm_v2/i);
  has(/create\s+or\s+replace\s+function\s+execute_amm_trade_v2/i);
  has(/insert\s+into\s+exchange_order_quotes[\s\S]*now\(\)\s*\+\s*interval\s+'20 seconds'/i);
  has(/book_version\s*<>\s*v_market\.book_version/i);
  has(/quote expired or stale; requote required/i);
  has(/create\s+or\s+replace\s+function\s+place_order_v2/i, readFileSync(new URL('../supabase/migrations/0058_exchange_v2_whole_coin_guardrails.sql', import.meta.url), 'utf8'));
  assert.match(clientSource, /quoteAmmV2/);
  assert.match(clientSource, /executeAmmTradeV2/);
});

test('0065 rounds whole coins in the house favor and caps bounded house mint from real net flow', () => {
  has(/exchange_round_amm_buy_cost_v2[\s\S]*ceil/i);
  has(/exchange_round_amm_sell_proceeds_v2[\s\S]*floor/i);
  has(/create\s+or\s+replace\s+function\s+exchange_amm_house_net_coin_mint_v2/i);
  has(/when\s+entry_type\s+in\s+\('sell_to_house',\s*'settlement_marker'\)\s+then\s+amount/i);
  has(/when\s+entry_type\s*=\s*'buy_from_house'\s+then\s+-amount/i);
  has(/create\s+or\s+replace\s+function\s+exchange_assert_amm_house_mint_cap_v2/i);
  has(/exchange_amm_house_net_coin_mint_v2\(p_market_id\)[\s\S]*exchange_assert_amm_house_mint_cap_v2/i);
  has(/create\s+or\s+replace\s+function\s+exchange_amm_house_settlement_exposure_v2/i);
  has(/entry_type,\s*amount,\s*currency,\s*idempotency_key,\s*metadata\)[\s\S]*'settlement_marker'[\s\S]*exchange_assert_amm_house_mint_cap_v2/i);
  assert.doesNotMatch(migration, /sum\(case\s+when\s+entry_type\s*=\s*'house_mint_reserved'\s+then\s+amount/i);
  const tradeLedgerInsert = migration.indexOf("'exchange:amm:house:' || p_action::text || ':' || p_quote_id::text");
  const tradeCapCheck = migration.indexOf('v_net_mint := exchange_amm_house_net_coin_mint_v2(p_market_id);');
  assert.ok(tradeLedgerInsert > 0 && tradeCapCheck > tradeLedgerInsert, 'trade cap check must include the current house-ledger insert');

  const rows = [
    { entry_type: 'house_mint_reserved', amount: 2000, currency: 'COIN', metadata: {} },
    { entry_type: 'buy_from_house', amount: 900, currency: 'COIN', metadata: { outcome: 'true', quantity: 1200 } },
    { entry_type: 'sell_to_house', amount: 450, currency: 'COIN', metadata: { outcome: 'true', quantity: 300 } },
  ];
  assert.equal(houseNetCoinMint(rows), -450, 'reserved cap entry is not actual mint usage');
  const exposure = settlementExposure(rows, 'true');
  assert.equal(exposure, 900, 'settlement exposure is net winning AMM shares, not the reserved cap row');
  rows.push({ entry_type: 'settlement_marker', amount: exposure, currency: 'COIN', metadata: { outcome: 'true' } });
  assert.equal(houseNetCoinMint(rows), 450);

  const state = { qYes: seedQYes(0.38), qNo: 0, b0: 2000, alpha: 0.05 };
  const quote = buyQuote(state, 100);
  assert.equal(quote.roundedCoins, Math.ceil(quote.cost));
  assert.ok(quote.after.normalizedPriceYes > quote.before.normalizedPriceYes);
});

test('liquidity-sensitive LMSR deepens as volume grows', () => {
  const open = { qYes: seedQYes(0.5), qNo: 0, b0: 2000, alpha: 0.05 };
  const first = buyQuote(open, 100);
  const deepState = { ...open, qYes: open.qYes + 5000, qNo: 5000 };
  const deep = buyQuote(deepState, 100);
  assert.ok(deep.before.b > first.before.b, 'b(q) increases with volume');
  assert.ok(Math.abs(deep.after.normalizedPriceYes - deep.before.normalizedPriceYes) < Math.abs(first.after.normalizedPriceYes - first.before.normalizedPriceYes));
});

maybeTest('0065 live dev-gated LMSR AMM opens, trades, deepens, caps house mint, settles, and keeps production gate false', async () => {
  const service = client(serviceRoleKey);
  const users = [];
  const rumorIds = [];
  let originalDevGate = null;

  async function createSignedInTestUser(label) {
    const email = `amm-${label}-${Date.now()}-${randomUUID()}@viddi.test`;
    const password = `Amm-${randomUUID()}-aA1!`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(`create ${label} user failed: ${created.error.message}`);
    const authed = client(anonKey);
    const signedIn = await authed.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error(`sign in ${label} user failed: ${signedIn.error.message}`);
    return { id: created.data.user.id, email, client: authed };
  }

  async function quoteAndExecute(userClient, marketId, outcome, action, quantity) {
    const quote = await rpc(userClient, 'quote_amm_v2', {
      p_market_id: marketId,
      p_outcome: outcome,
      p_action: action,
      p_quantity: quantity,
    });
    assert.equal(quote.marketId, marketId);
    assert.equal(quote.action, action);
    assert.equal(quote.outcome, outcome);
    const executed = await rpc(userClient, 'execute_amm_trade_v2', {
      p_market_id: marketId,
      p_outcome: outcome,
      p_action: action,
      p_quantity: quantity,
      p_quote_id: quote.quoteId,
      p_environment: 'development',
    });
    assert.equal(executed.ok, true);
    assert.equal(Number(executed.curveDeltaCoins).toFixed(6), Number(quote.curveDeltaCoins).toFixed(6));
    assert.equal(Number(executed.totalCoins), Number(quote.totalCoins));
    return { quote, executed };
  }

  try {
    await assertProductionGateFalse(service, 'before 0065 setup');
    originalDevGate = await single(service, 'exchange_feature_gates', (q) =>
      q.select('trading_enabled,selling_enabled,market_maker_enabled,fees_enabled,production_approved')
        .eq('environment', 'development')
    );
    assert.equal(originalDevGate.production_approved, false);
    const gateUpdate = await service.from('exchange_feature_gates')
      .update({ trading_enabled: true, selling_enabled: true, market_maker_enabled: true, fees_enabled: false })
      .eq('environment', 'development');
    if (gateUpdate.error) throw new Error(`development gate update failed: ${gateUpdate.error.message}`);
    await assertProductionGateFalse(service, 'after development gate enable');

    const trader = await createSignedInTestUser('trader');
    users.push(trader);
    const walletSeed = await service.from('coin_wallets').upsert([{ user_id: trader.id, balance: 10000, economy_config_version: 1 }], { onConflict: 'user_id' });
    if (walletSeed.error) throw new Error(`wallet seed failed: ${walletSeed.error.message}`);

    const inserted = await single(service, 'rumors', (q) => q.insert({
      summary: `0065 live LMSR AMM test ${randomUUID()}: cantora teria anunciado turnê`,
      status: 'speculated',
      is_hero: false,
      source_url: 'https://g1.globo.com/rss/g1/pop-arte/',
      source_label: '0065 live test',
      is_draft: false,
    }).select('id').single());
    rumorIds.push(inserted.id);

    const closeAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const resolveByAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await rpc(service, 'promote_rumor_to_exchange_market_v2', {
      p_rumor_id: inserted.id,
      p_close_at: closeAt,
      p_resolve_by_at: resolveByAt,
      p_resolution_policy: 'evidence',
      p_required_source_count: 1,
      p_tick_size: '0.01000000',
      p_quantity_step: '1.000000',
      p_min_order_quantity: '1.000000',
      p_opening_mark_price: '0.38000000',
      p_fee_bps: 0,
    });
    const opened = await rpc(service, 'open_exchange_market_v2', {
      p_market_id: inserted.id,
      p_amm_b0: '2000.000000',
      p_amm_alpha: '0.05000000',
      p_opening_mark_price: '0.38000000',
    });
    assert.equal(opened.state, 'open');

    let market = await single(service, 'exchange_markets', (q) => q.select('mark_price,amm_enabled,amm_b0,amm_alpha,amm_q_yes,amm_q_no,amm_max_house_mint_coins').eq('market_id', inserted.id));
    assert.equal(market.amm_enabled, true);
    assert.ok(Math.abs(Number(market.mark_price) - 0.38) <= 0.01);
    const stateAtOpen = lmsrState({ qYes: Number(market.amm_q_yes), qNo: Number(market.amm_q_no), b0: Number(market.amm_b0), alpha: Number(market.amm_alpha) });
    assert.ok(Math.abs(stateAtOpen.normalizedPriceYes - 0.38) <= 0.01);

    const buy = await quoteAndExecute(trader.client, inserted.id, 'true', 'buy', '100.000000');
    assert.ok(Number(buy.executed.priceYesAfter) > Number(buy.executed.priceYesBefore));
    assert.ok(Number(buy.executed.bAfter) > Number(buy.executed.bBefore));

    const sell = await quoteAndExecute(trader.client, inserted.id, 'true', 'sell', '25.000000');
    assert.ok(Number(sell.executed.priceYesAfter) < Number(sell.executed.priceYesBefore));
    assert.ok(Number(sell.executed.totalCoins) <= Math.ceil(Number(sell.executed.curveDeltaCoins)));

    const beforeHeavy = await rpc(trader.client, 'quote_amm_v2', { p_market_id: inserted.id, p_outcome: 'true', p_action: 'buy', p_quantity: '100.000000' });
    await quoteAndExecute(trader.client, inserted.id, 'true', 'buy', '1000.000000');
    await quoteAndExecute(trader.client, inserted.id, 'false', 'buy', '1000.000000');
    const afterHeavy = await rpc(trader.client, 'quote_amm_v2', { p_market_id: inserted.id, p_outcome: 'true', p_action: 'buy', p_quantity: '100.000000' });
    assert.ok(Number(afterHeavy.bBefore) > Number(beforeHeavy.bBefore));
    assert.ok(Math.abs(Number(afterHeavy.priceImpact)) < Math.abs(Number(beforeHeavy.priceImpact)));

    market = await single(service, 'exchange_markets', (q) => q.select('amm_max_house_mint_coins').eq('market_id', inserted.id));
    let houseRows = await service.from('exchange_amm_house_ledger').select('entry_type,amount,currency,metadata').eq('market_id', inserted.id);
    if (houseRows.error) throw new Error(`house ledger query failed: ${houseRows.error.message}`);
    const tradeNetMint = houseNetCoinMint(houseRows.data ?? []);
    assert.ok(tradeNetMint <= Number(market.amm_max_house_mint_coins), `trade net mint ${tradeNetMint} must stay <= cap ${market.amm_max_house_mint_coins}`);
    assert.notEqual((houseRows.data ?? []).filter((row) => row.entry_type === 'house_mint_reserved').reduce((sum, row) => sum + Number(row.amount), 0), tradeNetMint, 'cap assertion must use real trade flow, not reserved cap row');

    const resolved = await rpc(service, 'resolve_market_v2', {
      p_market_id: inserted.id,
      p_outcome: 'true',
      p_reference: '0065 LMSR live test evidence',
      p_idempotency_key: `amm-resolve-${randomUUID()}`,
    });
    assert.equal(resolved.state, 'resolved');
    houseRows = await service.from('exchange_amm_house_ledger').select('entry_type,amount,currency,metadata').eq('market_id', inserted.id);
    if (houseRows.error) throw new Error(`house settlement ledger query failed: ${houseRows.error.message}`);
    const settlementMarkers = (houseRows.data ?? []).filter((row) => row.entry_type === 'settlement_marker');
    assert.equal(settlementMarkers.length, 1);
    const finalNetMint = houseNetCoinMint(houseRows.data ?? []);
    assert.equal(Number(resolved.ammNetMintCoins), finalNetMint);
    assert.ok(finalNetMint <= Number(market.amm_max_house_mint_coins), `settled net mint ${finalNetMint} must stay <= cap ${market.amm_max_house_mint_coins}`);
    await assertProductionGateFalse(service, 'after settlement');
  } finally {
    if (originalDevGate) {
      await service.from('exchange_feature_gates').update(originalDevGate).eq('environment', 'development');
    }
    await assertProductionGateFalse(service, 'cleanup');
    for (const user of users) await service.auth.admin.deleteUser(user.id).catch(() => {});
    for (const rumorId of rumorIds) await service.from('rumors').delete().eq('id', rumorId);
  }
});
