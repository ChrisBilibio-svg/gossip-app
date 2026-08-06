import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDailyHero } from '../scripts/rotate-daily-hero.mjs';

const TODAY = '2026-07-27';
const m = (id, over = {}) => ({ id, summary: id, publish_at: '2026-07-20T00:00:00Z', set_date: null, is_hero: false, ...over });

test('no eligible markets returns null', () => {
  assert.equal(pickDailyHero([], { today: TODAY }), null);
});

test('a single eligible market is chosen', () => {
  assert.equal(pickDailyHero([m('a')], { today: TODAY }).id, 'a');
});

test('avoids re-featuring the market already set as today\'s hero', () => {
  const pool = [
    m('current', { is_hero: true, set_date: TODAY, publish_at: '2026-07-26T00:00:00Z' }),
    m('other', { publish_at: '2026-07-25T00:00:00Z' }),
  ];
  assert.equal(pickDailyHero(pool, { today: TODAY }).id, 'other');
});

test('rotates to the least-recently-featured market', () => {
  const pool = [
    m('featured_recently', { set_date: '2026-07-26' }),
    m('never_featured', { set_date: null }),
    m('featured_long_ago', { set_date: '2026-07-10' }),
  ];
  // never-featured (null) sorts before dated ones
  assert.equal(pickDailyHero(pool, { today: TODAY }).id, 'never_featured');
});

test('among equally-unfeatured, the freshest publish wins', () => {
  const pool = [
    m('older', { publish_at: '2026-07-20T00:00:00Z' }),
    m('newest', { publish_at: '2026-07-26T00:00:00Z' }),
    m('mid', { publish_at: '2026-07-23T00:00:00Z' }),
  ];
  assert.equal(pickDailyHero(pool, { today: TODAY }).id, 'newest');
});

test('is deterministic for the same input', () => {
  const pool = [m('a', { publish_at: '2026-07-26T00:00:00Z' }), m('b', { publish_at: '2026-07-26T00:00:00Z' })];
  assert.equal(pickDailyHero(pool, { today: TODAY }).id, pickDailyHero(pool, { today: TODAY }).id);
});

test('rotates to a different hero each day and features newly-added markets', () => {
  // simulate the real daily job: pick -> stamp set_date=today + is_hero -> repeat
  const pool = [
    m('A', { publish_at: '2026-07-20T00:00:00Z' }),
    m('B', { publish_at: '2026-07-19T00:00:00Z' }),
  ];
  const runDay = (day) => {
    const h = pickDailyHero(pool, { today: day });
    pool.forEach((x) => { x.is_hero = x.id === h.id; if (x.id === h.id) x.set_date = day; });
    return h.id;
  };

  const d1 = runDay('2026-07-27');
  const d2 = runDay('2026-07-28');
  assert.notEqual(d1, d2, 'hero must change day-over-day when an alternative exists');

  // a NEW market is published/added on day 3 -> it gets featured next run
  pool.push(m('C', { publish_at: '2026-07-28T12:00:00Z' }));
  const d3 = runDay('2026-07-29');
  assert.equal(d3, 'C', 'a newly-added market is featured as soon as it appears');

  const d4 = runDay('2026-07-30');
  assert.notEqual(d4, 'C', 'and rotation keeps moving the following day');
});
