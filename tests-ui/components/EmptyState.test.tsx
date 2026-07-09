/**
 * Shared empty/zero-data state used across MyBets, Leaderboard, Social, etc.
 */
import { render, screen } from '@testing-library/react-native';
import EmptyState from '../../src/components/EmptyState';

test('renders emoji, title, and body', async () => {
  await render(<EmptyState emoji="🍵" title="Nada por aqui" body="Volte mais tarde" />);
  expect(screen.getByText('🍵')).toBeTruthy();
  expect(screen.getByText('Nada por aqui')).toBeTruthy();
  expect(screen.getByText('Volte mais tarde')).toBeTruthy();
});

test('omits the body when not provided', async () => {
  await render(<EmptyState emoji="🧢" title="Sem palpites" />);
  expect(screen.getByText('Sem palpites')).toBeTruthy();
  expect(screen.queryByText('Volte mais tarde')).toBeNull();
});
