/**
 * Single source of truth for the Terms & Privacy shown at first launch (Story 1.2 / FR30).
 *
 * ⚠️ PLACEHOLDER WORDING — the final legally-binding text MUST come from a
 * Brazilian lawyer before public launch (launch-gating, per PRD NFR1). Bumping
 * `TERMS_VERSION` re-triggers the acceptance gate for everyone.
 */

export const TERMS_VERSION = '2026-06-03'; // bump to force re-acceptance

export const TERMS = {
  version: TERMS_VERSION,
  title: 'Antes de começar',
  intro:
    'Viddi é entretenimento. O conteúdo são opiniões e palpites da comunidade — nunca afirmações de fato sobre ninguém.',
  sections: [
    {
      heading: '1. É só diversão (opinião, não fato)',
      body:
        'Os "palpites" e porcentagens mostrados refletem a opinião da comunidade, não a verdade. Nada aqui deve ser tratado como acusação ou afirmação de fato sobre qualquer pessoa.',
    },
    {
      heading: '2. Conteúdo de usuários',
      body:
        'Comentários e palpites são de responsabilidade de quem os publica. Você concorda em não publicar conteúdo ilegal, difamatório ou de ódio, e pode denunciar ou bloquear outros usuários.',
    },
    {
      heading: '3. Sem responsabilidade',
      body:
        'O app é fornecido "como está". Na máxima extensão permitida pela lei, não nos responsabilizamos por danos decorrentes do uso do app ou do conteúdo publicado por usuários.',
    },
    {
      heading: '4. Idade e privacidade',
      body:
        'Você declara ter a idade mínima exigida. Tratamos seus dados conforme a LGPD; coletamos o mínimo necessário e você pode excluir sua conta a qualquer momento.',
    },
  ],
  acceptLabel: 'Aceitar e continuar',
  footnote:
    'Ao tocar em "Aceitar e continuar" você concorda com os Termos de Uso e a Política de Privacidade.',
} as const;
