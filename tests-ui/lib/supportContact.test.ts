import { buildSupportMailto, SUPPORT_EMAIL } from '../../src/lib/supportContact';

test('support contact uses the public company support email', () => {
  expect(SUPPORT_EMAIL).toBe('contato@viddi.app.br');
});

test('buildSupportMailto creates an encoded mailto link with subject and body', () => {
  const url = buildSupportMailto('ajuda@empresa.test');
  expect(url).toBe('mailto:ajuda@empresa.test?subject=Suporte+Viddi&body=Oi%2C+equipe+Viddi.+Preciso+de+ajuda+com%3A');
});
