/**
 * Sparkline — market graph visualization should be more informative than a tiny
 * unlabeled bar strip. It needs accessible labels plus min/current/max context
 * while staying native-dependency-free.
 */
import { render, screen } from '@testing-library/react-native';

import Sparkline from '../../src/components/Sparkline';

test('renders an accessible probability graph with min current and max labels', async () => {
  await render(<Sparkline data={[44, 51, 48, 63]} width={240} height={72} showLabels />);

  expect(screen.getByLabelText('Gráfico de probabilidade de ser verdade, atual 63%, mínimo 44%, máximo 63%')).toBeTruthy();
  expect(screen.getByText('Verdade agora')).toBeTruthy();
  expect(screen.getByText('63%')).toBeTruthy();
  expect(screen.getByText('min 44%')).toBeTruthy();
  expect(screen.getByText('max 63%')).toBeTruthy();
});
