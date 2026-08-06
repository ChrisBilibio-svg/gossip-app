/**
 * Bottom tab bar — the app's primary navigation. Verifies all tabs render,
 * the active tab is marked selected, and tapping reports the new tab.
 */
import { render, screen, fireEvent } from '@testing-library/react-native';
import BottomNav from '../../src/components/BottomNav';
import { ThemeProvider } from '../../src/theme/ThemeProvider';

function renderNav(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

test('renders all five tabs', async () => {
  await renderNav(<BottomNav tab="feed" onChange={() => {}} />);
  for (const label of ['A Coluna', 'Palpites', 'Social', 'O Profeta', 'Perfil']) {
    expect(screen.getByText(label)).toBeTruthy();
  }
});

test('marks the active tab as selected for accessibility', async () => {
  await renderNav(<BottomNav tab="rank" onChange={() => {}} />);
  expect(screen.getByLabelText('O Profeta').props.accessibilityState).toMatchObject({ selected: true });
  expect(screen.getByLabelText('A Coluna').props.accessibilityState).toMatchObject({ selected: false });
});

test('reports the tapped tab via onChange', async () => {
  const onChange = jest.fn();
  await renderNav(<BottomNav tab="feed" onChange={onChange} />);
  fireEvent.press(screen.getByLabelText('Social'));
  expect(onChange).toHaveBeenCalledWith('social');
});
