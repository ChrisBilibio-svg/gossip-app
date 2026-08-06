const PEXELS_SEARCH_URL = 'https://api.pexels.com/v1/search';

export const CANONICAL_IMAGE_CATEGORIES = Object.freeze([
  'Celebridades',
  'BBB',
  'Futebol',
  'Música',
  'Novelas',
  'Influencers',
]);

const DESCRIPTORS = Object.freeze({
  Celebridades: 'luzes de tapete vermelho e flashes',
  BBB: 'luzes de estúdio de televisão',
  Futebol: 'estádio de futebol vazio e bola',
  Música: 'microfone em palco de show',
  Novelas: 'claquete em cenário de filmagem',
  Influencers: 'smartphone e ring light em estúdio',
});

const CATEGORY_LOOKUP = new Map(CANONICAL_IMAGE_CATEGORIES.map((category) => [normalizeText(category), category]));

function normalizeText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

export function canonicalImageCategory(value) {
  return CATEGORY_LOOKUP.get(normalizeText(value)) ?? null;
}

/**
 * Returns a deterministic thematic query, never a person's name or a claim
 * about the alleged event. The summary is used only to select a safer object/
 * venue variant inside the already-approved category vocabulary.
 */
export function deriveNeutralDescriptor(summary, category) {
  const canonical = canonicalImageCategory(category);
  if (!canonical) return null;
  const text = normalizeText(summary);

  if (canonical === 'Música' && /album|disco|grava|musica|single|cancao/.test(text)) {
    return 'mesa de som em estúdio de gravação';
  }
  if (canonical === 'Futebol' && /trein|tecnico|escalacao/.test(text)) {
    return 'quadro tático de futebol e bola';
  }
  if (canonical === 'Novelas' && /roteir|capitulo|cena/.test(text)) {
    return 'roteiro e claquete em cenário de filmagem';
  }
  if (canonical === 'Influencers' && /podcast|entrevista/.test(text)) {
    return 'microfone de podcast em estúdio';
  }
  return DESCRIPTORS[canonical];
}

export function isSafeDescriptor(value) {
  const descriptor = String(value ?? '').trim();
  return descriptor.length >= 3
    && descriptor.length <= 100
    && !/[<>{}\r\n]/.test(descriptor)
    && !/https?:|javascript:/i.test(descriptor);
}

function trustedUrl(value, host, pathPrefix = '/') {
  try {
    const url = new URL(String(value ?? ''));
    const normalizedHost = url.hostname.toLowerCase();
    const hostMatches = normalizedHost === host || (host === 'pexels.com' && normalizedHost === 'www.pexels.com');
    return url.protocol === 'https:' && hostMatches && url.pathname.startsWith(pathPrefix) && url.toString().length <= 2048;
  } catch {
    return false;
  }
}

const UNSAFE_PHOTO_TERMS = /\b(?:person|people|portrait|man|men|woman|women|boy|girl|child|children|crowd|celebrity|logo|sign|billboard|poster|text|word|letter|newspaper|hospital|doctor|nurse|surgery|blood|weapon|gun|police|crime|prison|ambulance|pessoa|pessoas|retrato|homem|homens|mulher|mulheres|menino|menina|crianca|criancas|multidao|celebridade|placa|cartaz|texto|jornal|hospital|medico|medica|enfermeiro|enfermeira|cirurgia|sangue|arma|policia|crime|prisao|ambulancia)\b/;

function hasSafePhotoMetadata(photo) {
  const alt = normalizeText(photo?.alt);
  let slug = '';
  try {
    slug = normalizeText(new URL(String(photo?.url ?? '')).pathname.replace(/[-_/]+/g, ' '));
  } catch {
    return false;
  }
  const searchableMetadata = `${alt} ${slug}`;
  return alt.length >= 3 && alt.length <= 240 && !UNSAFE_PHOTO_TERMS.test(searchableMetadata);
}

export function normalizePexelsPhoto(photo, descriptor) {
  if (!photo || !isSafeDescriptor(descriptor) || !hasSafePhotoMetadata(photo)) return null;
  const id = String(photo.id ?? '');
  const imageUrl = photo.src?.landscape;
  const pageUrl = photo.url;
  const photographer = String(photo.photographer ?? '').trim();
  const photographerUrl = photo.photographer_url;
  const width = Number(photo.width);
  const height = Number(photo.height);

  if (!/^\d{1,32}$/.test(id)
    || !trustedUrl(imageUrl, 'images.pexels.com')
    || !trustedUrl(pageUrl, 'pexels.com', '/photo/')
    || !trustedUrl(photographerUrl, 'pexels.com')
    || photographer.length < 1
    || photographer.length > 120
    || /[<>{}\r\n]/.test(photographer)
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
    || width <= height) {
    return null;
  }

  const alt = `Imagem ilustrativa: ${descriptor}.`.slice(0, 180);
  return {
    imageUrl: new URL(imageUrl).toString(),
    alt,
    pageUrl: new URL(pageUrl).toString(),
    photographer,
    photographerUrl: new URL(photographerUrl).toString(),
    provider: 'pexels',
    providerId: id,
    descriptor,
  };
}

export async function searchPexelsImage({ apiKey, descriptor, fetchImpl = fetch, signal = AbortSignal.timeout(10_000) } = {}) {
  if (!apiKey || !isSafeDescriptor(descriptor)) return { image: null, reason: apiKey ? 'invalid_descriptor' : 'missing_api_key' };

  const url = new URL(PEXELS_SEARCH_URL);
  url.searchParams.set('query', descriptor);
  url.searchParams.set('orientation', 'landscape');
  url.searchParams.set('locale', 'pt-BR');
  url.searchParams.set('per_page', '10');

  let response;
  try {
    response = await fetchImpl(url, { headers: { Authorization: apiKey }, signal });
  } catch {
    return { image: null, reason: 'network_error' };
  }

  if (!response?.ok) {
    return { image: null, reason: response?.status === 429 ? 'rate_limited' : `http_${response?.status ?? 'error'}` };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { image: null, reason: 'malformed_response' };
  }

  if (!Array.isArray(payload?.photos)) return { image: null, reason: 'malformed_response' };
  for (const photo of payload.photos) {
    const image = normalizePexelsPhoto(photo, descriptor);
    if (image) return { image, reason: null };
  }
  return { image: null, reason: 'no_usable_image' };
}
