/**
 * Toolchain smoke test — validates that jest-expo + babel-preset-expo +
 * @testing-library/react-native + TypeScript/JSX all work together under the
 * package's "type": "module" setup. If this passes, the test harness is wired
 * correctly and real suites can build on it.
 *
 * Note: RNTL 14 (React 19 concurrent renderer) makes `render` async — it must
 * be awaited, and queries are read off `screen` afterwards.
 */
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

test('renders a React Native component through the test harness', async () => {
  await render(<Text>tea or cap</Text>);
  expect(screen.getByText('tea or cap')).toBeTruthy();
});
