/**
 * Social/reaction formatting (pure). These functions drive every count and
 * rating shown on rumor cards and the social feed.
 */
import {
  netScore,
  socialScore,
  formatReactionCount,
  ratingLabel,
} from '../../src/lib/socialFormat';

describe('netScore', () => {
  test('is likes minus dislikes', () => {
    expect(netScore(10, 3)).toBe(7);
  });
  test('never goes below zero', () => {
    expect(netScore(2, 9)).toBe(0);
  });
  test('zero when equal', () => {
    expect(netScore(5, 5)).toBe(0);
  });
});

describe('socialScore', () => {
  test('can be negative (unlike netScore)', () => {
    expect(socialScore(2, 9)).toBe(-7);
  });
  test('matches likes minus dislikes', () => {
    expect(socialScore(12, 4)).toBe(8);
  });
});

describe('formatReactionCount', () => {
  test('shows raw count under 1000', () => {
    expect(formatReactionCount(0)).toBe('0');
    expect(formatReactionCount(999)).toBe('999');
  });
  test('uses k with one decimal between 1k and 10k', () => {
    expect(formatReactionCount(1000)).toBe('1.0k');
    expect(formatReactionCount(1500)).toBe('1.5k');
  });
  test('drops the decimal at or above 10k', () => {
    expect(formatReactionCount(10000)).toBe('10k');
    expect(formatReactionCount(12345)).toBe('12k');
  });
  test('uses M with one decimal between 1M and 10M', () => {
    expect(formatReactionCount(1_500_000)).toBe('1.5M');
  });
  test('drops the decimal at or above 10M', () => {
    expect(formatReactionCount(12_000_000)).toBe('12M');
  });
});

describe('ratingLabel', () => {
  test('renders filled and empty stars for a mid rating', () => {
    expect(ratingLabel(3)).toBe('★★★☆☆');
  });
  test('clamps below 1 up to 1 star', () => {
    expect(ratingLabel(0)).toBe('★☆☆☆☆');
    expect(ratingLabel(-4)).toBe('★☆☆☆☆');
  });
  test('clamps above 5 down to 5 stars', () => {
    expect(ratingLabel(6)).toBe('★★★★★');
  });
});
