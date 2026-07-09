import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatReactionCount, netScore, ratingLabel, socialScore } from '../src/lib/socialFormat.ts';

test('formatReactionCount keeps small counts exact and compacts larger counts', () => {
  assert.equal(formatReactionCount(42), '42');
  assert.equal(formatReactionCount(1200), '1.2k');
  assert.equal(formatReactionCount(12_300), '12k');
  assert.equal(formatReactionCount(1_250_000), '1.3M');
});

test('netScore floors gossip popularity at zero', () => {
  assert.equal(netScore(10, 4), 6);
  assert.equal(netScore(2, 8), 0);
});

test('ratingLabel clamps social repost ratings to one through five stars', () => {
  assert.equal(ratingLabel(4), '★★★★☆');
  assert.equal(ratingLabel(9), '★★★★★');
  assert.equal(ratingLabel(0), '★☆☆☆☆');
});

test('socialScore allows negative scores for ranking reposts', () => {
  assert.equal(socialScore(3, 7), -4);
});
