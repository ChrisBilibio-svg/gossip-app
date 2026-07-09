/**
 * Status-tier ladder. Pure tier math (drives Profile + leaderboard progression)
 * plus a render check of the badge.
 */
import { render, screen } from '@testing-library/react-native';
import { tierForPoints, nextTier, TierBadge } from '../../src/components/Tier';

describe('tierForPoints', () => {
  test.each([
    [0, 'Aprendiz'],
    [99, 'Aprendiz'],
    [100, 'Fofoqueiro'],
    [499, 'Fofoqueiro'],
    [500, 'Vidente'],
    [1499, 'Vidente'],
    [1500, 'Profeta'],
    [4999, 'Profeta'],
    [5000, 'Lenda'],
    [999999, 'Lenda'],
  ])('%i points → %s', (points, name) => {
    expect(tierForPoints(points).name).toBe(name);
  });
});

describe('nextTier', () => {
  test('points to the next rung up', () => {
    expect(nextTier(0)?.name).toBe('Fofoqueiro');
    expect(nextTier(1499)?.name).toBe('Profeta');
    expect(nextTier(4999)?.name).toBe('Lenda');
  });
  test('returns null at the top tier', () => {
    expect(nextTier(5000)).toBeNull();
    expect(nextTier(10000)).toBeNull();
  });
});

describe('TierBadge', () => {
  test('renders the tier name and emoji for the given points', async () => {
    await render(<TierBadge points={600} />);
    expect(screen.getByText('Vidente')).toBeTruthy();
    expect(screen.getByText('🔮')).toBeTruthy();
  });
});
