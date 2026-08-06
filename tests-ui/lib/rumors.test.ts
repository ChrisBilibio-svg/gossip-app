/**
 * Rumor data shaping (pure). `splitPercent` is the crowd-split math the whole
 * vote UI renders, and `mapRumorRows` is the snake_case→camelCase contract
 * every screen consumes. Both are easy to break silently, so we pin them.
 */
import { splitPercent, mapRumorRows, type RumorRow } from '../../src/lib/rumors';

describe('splitPercent', () => {
  test('defaults to 50/50 when there are no votes (never 0/0)', () => {
    expect(splitPercent({ trueTotal: 0, falseTotal: 0 })).toEqual({ tea: 50, cap: 50 });
  });
  test('computes integer percentages that always sum to 100', () => {
    const s = splitPercent({ trueTotal: 1, falseTotal: 2 });
    expect(s.tea + s.cap).toBe(100);
    expect(s.tea).toBe(33);
    expect(s.cap).toBe(67);
  });
  test('rounds cleanly for simple ratios', () => {
    expect(splitPercent({ trueTotal: 3, falseTotal: 1 })).toEqual({ tea: 75, cap: 25 });
  });
  test('handles a fully one-sided split', () => {
    expect(splitPercent({ trueTotal: 10, falseTotal: 0 })).toEqual({ tea: 100, cap: 0 });
  });
});

function row(overrides: Partial<RumorRow> = {}): RumorRow {
  return {
    id: 'r1',
    summary: 'Headline',
    article: 'Body',
    category: 'BBB',
    status: 'speculated',
    is_hero: true,
    source_url: null,
    prediction_deadline: null,
    resolution_policy: 'deadline',
    required_source_count: 2,
    created_at: '2026-06-01T00:00:00Z',
    resolved_at: null,
    seed_true: 10,
    seed_false: 5,
    true_votes: 3,
    false_votes: 2,
    like_count: 7,
    dislike_count: 1,
    comment_count: 4,
    my_choice: 'true',
    my_reaction: 1,
    ...overrides,
  };
}

describe('mapRumorRows', () => {
  test('maps snake_case columns to the camelCase Rumor shape', () => {
    const [r] = mapRumorRows([row()]);
    expect(r.id).toBe('r1');
    expect(r.category).toBe('BBB');
    expect(r.isHero).toBe(true);
    expect(r.resolutionPolicy).toBe('deadline');
    expect(r.requiredSourceCount).toBe(2);
    expect(r.commentCount).toBe(4);
    expect(r.myChoice).toBe('true');
    expect(r.myReaction).toBe(1);
    expect(r.editorialImage).toBeNull();
  });

  test('maps only complete trusted Pexels metadata', () => {
    const complete = row({
      editorial_image_url: 'https://images.pexels.com/photos/123/photo.jpeg',
      editorial_image_alt: 'Imagem ilustrativa: palco de show.',
      editorial_image_page_url: 'https://www.pexels.com/photo/stage-123/',
      editorial_image_photographer: 'Foto Exemplo',
      editorial_image_photographer_url: 'https://www.pexels.com/@foto-exemplo',
      editorial_image_provider: 'pexels',
      editorial_image_provider_id: '123',
      editorial_image_descriptor: 'palco de show',
      editorial_image_feature_date: '2026-08-05',
    });
    expect(mapRumorRows([complete])[0].editorialImage).toEqual({
      url: 'https://images.pexels.com/photos/123/photo.jpeg',
      alt: 'Imagem ilustrativa: palco de show.',
      pageUrl: 'https://www.pexels.com/photo/stage-123/',
      photographer: 'Foto Exemplo',
      photographerUrl: 'https://www.pexels.com/@foto-exemplo',
      provider: 'pexels',
      providerId: '123',
      descriptor: 'palco de show',
      featureDate: '2026-08-05',
    });

    expect(mapRumorRows([{ ...complete, editorial_image_photographer: null }])[0].editorialImage).toBeNull();
    expect(mapRumorRows([{ ...complete, editorial_image_url: 'https://evil.example/photo.jpeg' }])[0].editorialImage).toBeNull();
  });

  test('passes through VOID as a terminal no-verdict status', () => {
    const [r] = mapRumorRows([row({ status: 'void', resolved_at: '2026-06-08T00:00:00Z' })]);
    expect(r.status).toBe('void');
    expect(r.resolvedAt).toBe('2026-06-08T00:00:00Z');
  });

  test('totals are seed + real votes', () => {
    const [r] = mapRumorRows([row()]);
    expect(r.trueTotal).toBe(13); // seed_true 10 + true_votes 3
    expect(r.falseTotal).toBe(7); // seed_false 5 + false_votes 2
  });

  test('applies safe defaults for nullable fields', () => {
    const [r] = mapRumorRows([
      row({
        resolution_policy: undefined as unknown as RumorRow['resolution_policy'],
        required_source_count: undefined as unknown as number,
        category: undefined,
        like_count: null,
        dislike_count: null,
        comment_count: null,
        my_choice: null,
        my_reaction: null,
      }),
    ]);
    expect(r.resolutionPolicy).toBe('evidence');
    expect(r.category).toBeNull();
    expect(r.requiredSourceCount).toBe(2);
    expect(r.likeCount).toBe(0);
    expect(r.dislikeCount).toBe(0);
    expect(r.commentCount).toBe(0);
    expect(r.myChoice).toBeNull();
    expect(r.myReaction).toBeNull();
  });

  test('maps nested evidence sources, defaulting to an empty array', () => {
    const [withSources] = mapRumorRows([
      row({
        rumor_evidence_sources: [
          { id: 's1', source_url: 'https://x', source_label: 'X', supports_outcome: true, note: null },
        ],
      }),
    ]);
    expect(withSources.evidenceSources).toEqual([
      { id: 's1', sourceUrl: 'https://x', sourceLabel: 'X', supportsOutcome: true, note: null },
    ]);

    const [noSources] = mapRumorRows([row({ rumor_evidence_sources: null })]);
    expect(noSources.evidenceSources).toEqual([]);
  });
});
