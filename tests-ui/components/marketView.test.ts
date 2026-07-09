import { canSeeMarketStats, toMarketStatus } from '../../src/components/marketView';

test('toMarketStatus maps backend statuses to display chips', () => {
  expect(toMarketStatus('speculated')).toBe('ABERTO');
  expect(toMarketStatus('confirmed')).toBe('CONFIRMADO');
  expect(toMarketStatus('debunked')).toBe('CAP');
  expect(toMarketStatus('void')).toBe('VOID');
});

test('free users cannot see open market stats before placing a bet', () => {
  expect(canSeeMarketStats({ status: 'speculated', myChoice: null, viewerIsPro: false })).toBe(false);
});

test('placing a bet unlocks open market stats for free users', () => {
  expect(canSeeMarketStats({ status: 'speculated', myChoice: 'true', viewerIsPro: false })).toBe(true);
  expect(canSeeMarketStats({ status: 'speculated', myChoice: 'false', viewerIsPro: false })).toBe(true);
});

test('Viddi Pro users can see open market stats before betting', () => {
  expect(canSeeMarketStats({ status: 'speculated', myChoice: null, viewerIsPro: true })).toBe(true);
});

test('resolved market stats remain visible after the prediction is over', () => {
  expect(canSeeMarketStats({ status: 'confirmed', myChoice: null, viewerIsPro: false })).toBe(true);
  expect(canSeeMarketStats({ status: 'debunked', myChoice: null, viewerIsPro: false })).toBe(true);
  expect(canSeeMarketStats({ status: 'void', myChoice: null, viewerIsPro: false })).toBe(true);
});
