-- 0001_rumors.sql — Rumors table + RLS + seed (Story 1.5 / FR1, FR4)

-- Lifecycle of a rumor.
create type rumor_status as enum ('speculated', 'confirmed', 'debunked');

create table rumors (
  id               uuid primary key default gen_random_uuid(),
  summary          text not null,
  status           rumor_status not null default 'speculated',
  set_date         date not null default current_date,
  is_hero          boolean not null default false,
  publish_at       timestamptz not null default now(),
  source_url       text,
  -- launch seeding so the crowd split is never 0/0
  seed_true        integer not null default 0,
  seed_false       integer not null default 0,
  -- real votes (incremented by place_bet in Story 2.1)
  true_votes       integer not null default 0,
  false_votes      integer not null default 0,
  resolved_at      timestamptz,
  resolved_outcome boolean,            -- true = confirmed true, false = debunked
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default now()
);

-- Exactly one hero per day.
create unique index one_hero_per_day on rumors (set_date) where is_hero;

-- Fast feed reads.
create index rumors_feed_idx on rumors (publish_at desc);

-- RLS: anyone (anon or signed-in) can read rumors that are already published.
alter table rumors enable row level security;

create policy "read published rumors"
  on rumors for select
  to anon, authenticated
  using (publish_at <= now());

-- ── Seed today's set (1 hero + supporting), with plausible vote counts ──
insert into rumors (summary, status, is_hero, seed_true, seed_false, source_url) values
  ('A fofoca diz que [Celebridade A] assinou em segredo com a gravadora rival 👀', 'speculated', true, 1420, 880, null),
  ('[Casal Famoso] teria terminado depois do Carnaval, segundo perfis de fofoca', 'speculated', false, 1130, 690, null),
  ('[Influencer B] estaria de affair com [Cantor C], dizem os bastidores', 'speculated', false, 540, 410, null),
  ('[Atleta D] estaria de saída do clube na próxima janela', 'speculated', false, 760, 980, null),
  ('[Apresentadora E] confirmou mudança de emissora ao vivo', 'confirmed', false, 0, 0, 'https://example.com/fonte');
