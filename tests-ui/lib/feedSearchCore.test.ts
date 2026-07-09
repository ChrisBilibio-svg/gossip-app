/**
 * Feed keyword search (pure). Guards the search behaviour the Feed depends on:
 * accent-insensitive matching over headline + article, and newest-first order.
 */
import { applyOpenFeed, filterRumors, filterRumorsByQuery, type SearchableRumor } from '../../src/lib/feedSearchCore';

const r = (summary: string, article: string | null, createdAt: string, extra: Partial<SearchableRumor> = {}): SearchableRumor => ({
  summary,
  article,
  category: null,
  createdAt,
  ...extra,
});

const SAMPLE: SearchableRumor[] = [
  r('Anitta lança novo álbum', 'detalhes do álbum surpresa', '2026-06-01T10:00:00Z', {
    status: 'confirmed',
    resolutionPolicy: 'evidence',
    predictionDeadline: '2026-06-08T10:00:00Z',
    trueTotal: 90,
    falseTotal: 10,
    commentCount: 2,
    myChoice: 'true',
  }),
  r('Briga no BBB esquenta', null, '2026-06-03T10:00:00Z', {
    status: 'speculated',
    resolutionPolicy: 'deadline',
    predictionDeadline: '2026-06-04T09:00:00Z',
    trueTotal: 12,
    falseTotal: 8,
    commentCount: 7,
  }),
  r('Casamento secreto em São Paulo', 'fontes próximas confirmam', '2026-06-02T10:00:00Z', {
    status: 'void',
    resolutionPolicy: 'evidence',
    predictionDeadline: '2026-06-09T10:00:00Z',
    trueTotal: 25,
    falseTotal: 30,
    commentCount: 4,
  }),
];

test('empty query returns everything, newest-first', () => {
  const out = filterRumorsByQuery(SAMPLE, '');
  expect(out.map((x) => x.createdAt)).toEqual([
    '2026-06-03T10:00:00Z',
    '2026-06-02T10:00:00Z',
    '2026-06-01T10:00:00Z',
  ]);
});

test('whitespace-only query is treated as empty', () => {
  expect(filterRumorsByQuery(SAMPLE, '   ')).toHaveLength(SAMPLE.length);
});

test('matches the headline', () => {
  const out = filterRumorsByQuery(SAMPLE, 'anitta');
  expect(out).toHaveLength(1);
  expect(out[0].summary).toContain('Anitta');
});

test('matches the article body, not just the headline', () => {
  const out = filterRumorsByQuery(SAMPLE, 'fontes');
  expect(out).toHaveLength(1);
  expect(out[0].summary).toContain('Casamento');
});

test('is accent-insensitive (sao paulo matches São Paulo)', () => {
  expect(filterRumorsByQuery(SAMPLE, 'sao paulo')).toHaveLength(1);
});

test('is case-insensitive', () => {
  expect(filterRumorsByQuery(SAMPLE, 'BBB')).toHaveLength(1);
  expect(filterRumorsByQuery(SAMPLE, 'bbb')).toHaveLength(1);
});

test('matches category labels', () => {
  const out = filterRumorsByQuery([
    r('Reality rumor', null, '2026-06-01T00:00:00Z', { category: 'BBB' }),
    r('Music rumor', null, '2026-06-02T00:00:00Z', { category: 'Música' }),
  ], 'musica');

  expect(out.map((x) => x.summary)).toEqual(['Music rumor']);
});

test('no match returns empty', () => {
  expect(filterRumorsByQuery(SAMPLE, 'criptomoeda')).toEqual([]);
});

test('results are always newest-first even after filtering', () => {
  const out = filterRumorsByQuery(SAMPLE, 'a'); // matches multiple
  for (let i = 1; i < out.length; i++) {
    expect(new Date(out[i - 1].createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(out[i].createdAt).getTime(),
    );
  }
});

test('does not mutate the input array', () => {
  const input = [...SAMPLE];
  filterRumorsByQuery(input, 'anitta');
  expect(input).toEqual(SAMPLE);
});

test('closing-soon filter returns only open deadlines inside the next 48h, deadline-first', () => {
  const out = filterRumors(SAMPLE, '', 'closing-soon', new Date('2026-06-03T10:00:00Z').getTime());
  expect(out.map((x) => x.summary)).toEqual(['Briga no BBB esquenta']);
});

test('popular filter sorts by total market volume', () => {
  const out = filterRumors(SAMPLE, '', 'popular');
  expect(out.map((x) => x.summary)).toEqual([
    'Anitta lança novo álbum',
    'Casamento secreto em São Paulo',
    'Briga no BBB esquenta',
  ]);
});

test('most-commented filter sorts by visible comment count, then newest', () => {
  const out = filterRumors(
    [
      ...SAMPLE,
      r('Novo empate', null, '2026-06-04T10:00:00Z', { commentCount: 7, trueTotal: 1, falseTotal: 1 }),
    ],
    '',
    'most-commented',
  );

  expect(out.map((x) => x.summary)).toEqual([
    'Novo empate',
    'Briga no BBB esquenta',
    'Casamento secreto em São Paulo',
    'Anitta lança novo álbum',
  ]);
});

test('policy filters narrow the legacy feed fallback', () => {
  expect(filterRumors(SAMPLE, '', 'deadline').map((x) => x.summary)).toEqual(['Briga no BBB esquenta']);
  expect(filterRumors(SAMPLE, '', 'evidence')).toHaveLength(2);
});

test('open quick discussion filter replaces the redundant my-picks shortcut', () => {
  const rows = [
    r('Sem comentários', null, '2026-06-05T10:00:00Z', { status: 'speculated', commentCount: 0, trueTotal: 40, falseTotal: 20 }),
    r('Discussão quente', null, '2026-06-04T10:00:00Z', { status: 'speculated', commentCount: 8, trueTotal: 3, falseTotal: 2 }),
    r('Também comentado', null, '2026-06-03T10:00:00Z', { status: 'speculated', commentCount: 1, trueTotal: 30, falseTotal: 20 }),
  ];

  expect(applyOpenFeed(rows, '', 'recent', ['discussion']).map((x) => x.summary)).toEqual([
    'Discussão quente',
    'Também comentado',
  ]);
});

test('resolved outcome filters distinguish TEA, CAP, and VOID', () => {
  const cap = r('Virou CAP', null, '2026-06-04T10:00:00Z', { status: 'debunked' });
  const rows = [...SAMPLE, cap];
  expect(filterRumors(rows, '', 'tea').map((x) => x.summary)).toEqual(['Anitta lança novo álbum']);
  expect(filterRumors(rows, '', 'cap').map((x) => x.summary)).toEqual(['Virou CAP']);
  expect(filterRumors(rows, '', 'void').map((x) => x.summary)).toEqual(['Casamento secreto em São Paulo']);
});
