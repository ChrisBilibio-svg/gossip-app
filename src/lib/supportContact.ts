export const SUPPORT_EMAIL = 'contato@viddi.app.br';

function encodeMailtoParam(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

export function buildSupportMailto(email = SUPPORT_EMAIL): string {
  const subject = encodeMailtoParam('Suporte Viddi');
  const body = encodeMailtoParam('Oi, equipe Viddi. Preciso de ajuda com:');
  return `mailto:${email}?subject=${subject}&body=${body}`;
}
