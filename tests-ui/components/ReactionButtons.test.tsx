/**
 * 🍵 like / 👎 dislike reaction buttons. Verifies counts render (via the shared
 * formatter), the active reaction is reflected in accessibility state, and taps
 * report the right value. expo-haptics is auto-mocked by jest-expo.
 */
import { render, screen, fireEvent } from '@testing-library/react-native';
import ReactionButtons from '../../src/components/ReactionButtons';

test('renders both reaction counts using the compact formatter', async () => {
  await render(
    <ReactionButtons likeCount={1500} dislikeCount={3} myReaction={null} onReact={() => {}} />,
  );
  expect(screen.getByText('1.5k')).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
});

test('reflects the current reaction in accessibility state', async () => {
  await render(
    <ReactionButtons likeCount={4} dislikeCount={1} myReaction={1} onReact={() => {}} />,
  );
  expect(screen.getByLabelText('Curtir fofoca').props.accessibilityState).toMatchObject({
    selected: true,
  });
  expect(screen.getByLabelText('Não curtir fofoca').props.accessibilityState).toMatchObject({
    selected: false,
  });
});

test('reports a like as +1 and a dislike as -1', async () => {
  const onReact = jest.fn();
  await render(
    <ReactionButtons likeCount={0} dislikeCount={0} myReaction={null} onReact={onReact} />,
  );
  fireEvent.press(screen.getByLabelText('Curtir fofoca'));
  expect(onReact).toHaveBeenCalledWith(1);

  fireEvent.press(screen.getByLabelText('Não curtir fofoca'));
  expect(onReact).toHaveBeenCalledWith(-1);
});
