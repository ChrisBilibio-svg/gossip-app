import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import EditorialArtwork from '../../src/components/EditorialArtwork';
import type { EditorialImage } from '../../src/lib/rumors';

const image: EditorialImage = {
  url: 'https://images.pexels.com/photos/123/photo.jpeg',
  alt: 'Imagem ilustrativa: microfone em palco de show.',
  pageUrl: 'https://www.pexels.com/photo/microphone-123/',
  photographer: 'Foto Exemplo',
  photographerUrl: 'https://www.pexels.com/@foto-exemplo',
  provider: 'pexels',
  providerId: '123',
  descriptor: 'microfone em palco de show',
  featureDate: '2026-08-05',
};

test('detail credit identifies the photographer and opens the Pexels photo page', async () => {
  const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await render(<EditorialArtwork image={image} detail />);
  expect(screen.getByText('Imagem ilustrativa · Foto: Foto Exemplo / Pexels')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Abrir crédito da foto de Foto Exemplo no Pexels'));
  await waitFor(() => expect(openUrl).toHaveBeenCalledWith(image.pageUrl));
  openUrl.mockRestore();
});

test('image load errors collapse the artwork without a broken fallback frame', async () => {
  await render(<EditorialArtwork image={image} />);
  fireEvent(screen.getByLabelText(image.alt), 'error');
  await waitFor(() => expect(screen.queryByLabelText(image.alt)).toBeNull());
  expect(screen.queryByText(/Foto Exemplo/)).toBeNull();
});

test('a stale load error cannot collapse a replacement URL', async () => {
  const rendered = await render(<EditorialArtwork image={image} />);
  const staleOnError = screen.getByLabelText(image.alt).props.onError;
  const replacement = {
    ...image,
    url: 'https://images.pexels.com/photos/456/photo.jpeg',
    alt: 'Imagem ilustrativa: estúdio vazio.',
    providerId: '456',
  };
  await rendered.rerender(<EditorialArtwork image={replacement} />);
  await act(async () => { staleOnError(); });
  expect(screen.getByLabelText(replacement.alt)).toBeTruthy();
});

test('invalid attribution URLs stay non-interactive', async () => {
  await render(<EditorialArtwork image={{ ...image, pageUrl: 'https://example.com/photo' }} detail />);
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.getByText(/Foto Exemplo \/ Pexels/)).toBeTruthy();
});
