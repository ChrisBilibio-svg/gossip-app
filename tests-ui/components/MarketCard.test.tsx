import { render, screen } from '@testing-library/react-native';
import MarketCard from '../../src/components/MarketCard';
import type { Rumor } from '../../src/lib/rumors';

function makeRumor(overrides: Partial<Rumor> = {}): Rumor {
  return {
    id: 'rumor-1',
    summary: 'Will Team A win?',
    article: null,
    status: 'speculated',
    isHero: false,
    sourceUrl: null,
    predictionDeadline: '2026-08-01T00:00:00Z',
    resolutionPolicy: 'deadline',
    requiredSourceCount: 2,
    evidenceSources: [],
    createdAt: '2026-06-01T00:00:00Z',
    resolvedAt: null,
    trueTotal: 40,
    falseTotal: 60,
    myChoice: null,
    likeCount: 0,
    dislikeCount: 0,
    commentCount: 0,
    sourceCount: 1,
    oddsHistory: [],
    updatesRumor: null,
    myReaction: null,
    category: null,
    editorialImage: null,
    ...overrides,
  };
}

test('open market cards show current odds before trading and no stats lock', async () => {
  await render(<MarketCard rumor={makeRumor()} onPress={jest.fn()} onTakePosition={jest.fn()} />);
  expect(screen.getByText('Will Team A win?')).toBeTruthy();
  expect(screen.getByText('Probabilidade: 40%')).toBeTruthy();
  expect(screen.getByText('Retorno atual: 2.38x')).toBeTruthy();
  expect(screen.getByText('Probabilidade: 60%')).toBeTruthy();
  expect(screen.getByText('Retorno atual: 1.58x')).toBeTruthy();
  expect(screen.getByLabelText('Escolher Verdade')).toBeTruthy();
  expect(screen.getByLabelText('Escolher Mentira')).toBeTruthy();
  expect(screen.queryByLabelText('Ilustração editorial da editoria Cultura pop')).toBeNull();
  expect(screen.getByText('Cultura pop')).toBeTruthy();
  expect(screen.queryByText(/Palpite para ver odds/i)).toBeNull();
  expect(screen.getByText(/Moedas não têm valor em dinheiro/i)).toBeTruthy();
});

test('photo cards render complete illustrative media and visible attribution', async () => {
  await render(
    <MarketCard
      rumor={makeRumor({
        category: 'Música',
        editorialImage: {
          url: 'https://images.pexels.com/photos/123/photo.jpeg',
          alt: 'Imagem ilustrativa: microfone em palco de show.',
          pageUrl: 'https://www.pexels.com/photo/microphone-123/',
          photographer: 'Foto Exemplo',
          photographerUrl: 'https://www.pexels.com/@foto-exemplo',
          provider: 'pexels',
          providerId: '123',
          descriptor: 'microfone em palco de show',
          featureDate: '2026-08-05',
        },
      })}
      onPress={jest.fn()}
    />,
  );
  expect(screen.getByLabelText('Imagem ilustrativa: microfone em palco de show.')).toBeTruthy();
  expect(screen.getByText('Imagem ilustrativa · Foto: Foto Exemplo / Pexels')).toBeTruthy();
});
