jest.mock('../../src/lib/economy', () => {
  const actual = jest.requireActual('../../src/lib/economy');
  return {
    ...actual,
    getCoinEconomyState: jest.fn(),
  };
});

import { render, screen, fireEvent } from '@testing-library/react-native';
import CoinStoreButton from '../../src/components/CoinStoreButton';
import { getCoinEconomyState, DEFAULT_DISABLED_ECONOMY_STATE } from '../../src/lib/economy';

const mockEconomy = getCoinEconomyState as jest.Mock;

beforeEach(() => {
  mockEconomy.mockReset().mockResolvedValue({ ...DEFAULT_DISABLED_ECONOMY_STATE, featureEnabled: true, purchasesKilled: false, balance: 1234 });
});

test('coin store top-right control shows the wallet balance and opens product options', async () => {
  await render(<CoinStoreButton compact />);
  expect(await screen.findByLabelText('Loja de moedas')).toBeTruthy();
  expect(screen.getByText('1.234')).toBeTruthy();

  fireEvent.press(screen.getByLabelText('Loja de moedas'));
  expect(await screen.findByText('125 moedas')).toBeTruthy();
  expect(screen.getByText('750 moedas')).toBeTruthy();
  expect(screen.getByText('1.650 moedas')).toBeTruthy();
  expect(screen.getByText('Viddi Pro')).toBeTruthy();
  expect(screen.getByText(/300 moedas agora \+ 40 por dia por 30 dias = 1.500 moedas programadas/)).toBeTruthy();
  expect(screen.getAllByText(/usuários grátis e Pro/i).length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText(/não têm valor em dinheiro/i)).toBeTruthy();
});
