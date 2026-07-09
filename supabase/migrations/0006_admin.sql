-- 0006_admin.sql — Curator role, permissions, audit (Epic 5 / FR20-22)

alter table profiles add column is_curator boolean not null default false;

create or replace function is_curator()
returns boolean language sql security definer set search_path = public stable as $$
  select coalesce((select is_curator from profiles where id = auth.uid()), false);
$$;

-- Curators manage rumors
create policy "curator read all rumors" on rumors for select to authenticated using (is_curator());
create policy "curator insert rumors" on rumors for insert to authenticated with check (is_curator());
create policy "curator update rumors" on rumors for update to authenticated using (is_curator());
create policy "curator delete rumors" on rumors for delete to authenticated using (is_curator());

-- Curators moderate comments + reports
create policy "curator read all comments" on comments for select to authenticated using (is_curator());
create policy "curator update comments" on comments for update to authenticated using (is_curator());
create policy "curator read reports" on comment_reports for select to authenticated using (is_curator());
create policy "curator resolve reports" on comment_reports for update to authenticated using (is_curator());

-- Resolving is curator-only (allow service/SQL where auth.uid() is null; block non-curator users)
create or replace function resolve_rumor(p_rumor_id uuid, p_outcome boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rumor      rumors;
  v_resolved   timestamptz;
  v_life       numeric;
  r            predictions;
  v_total      numeric;
  v_pick_share numeric;
  v_contrarian numeric;
  v_early      numeric;
  v_correct    boolean;
  v_points     integer;
  BASE         constant numeric := 100;
  EARLY_BONUS  constant numeric := 0.5;
begin
  if auth.uid() is not null and not is_curator() then
    raise exception 'not a curator';
  end if;

  select * into v_rumor from rumors where id = p_rumor_id for update;
  if not found then raise exception 'rumor not found'; end if;

  v_resolved := coalesce(v_rumor.resolved_at, now());

  update rumors set
    status           = (case when p_outcome then 'confirmed' else 'debunked' end)::rumor_status,
    resolved_outcome = p_outcome,
    resolved_at      = v_resolved
  where id = p_rumor_id;

  v_life := greatest(extract(epoch from (v_resolved - v_rumor.publish_at)), 1);

  for r in select * from predictions where rumor_id = p_rumor_id and scored_at is null loop
    v_correct := ((r.choice = 'true') = p_outcome);
    if v_correct then
      v_total := greatest(r.crowd_true_at_cast + r.crowd_false_at_cast, 1);
      v_pick_share := (case when r.choice = 'true' then r.crowd_true_at_cast else r.crowd_false_at_cast end)::numeric / v_total;
      v_contrarian := 1 + (1 - v_pick_share);
      v_early := 1 + EARLY_BONUS * greatest(least(extract(epoch from (v_resolved - r.cast_at)) / v_life, 1), 0);
      v_points := round(BASE * v_contrarian * v_early);
    else
      v_points := 0;
    end if;
    update predictions set is_correct = v_correct, points_awarded = v_points, scored_at = now() where id = r.id;
    update profiles set
      total_points = total_points + v_points,
      correct_count = correct_count + (case when v_correct then 1 else 0 end),
      resolved_count = resolved_count + 1
    where id = r.user_id;
  end loop;
end;
$$;
grant execute on function resolve_rumor(uuid, boolean) to authenticated;

-- Audit trail
create table audit_log (
  id       uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) default auth.uid(),
  action   text not null,
  rumor_id uuid,
  detail   jsonb,
  at       timestamptz not null default now()
);
alter table audit_log enable row level security;
create policy "curator read audit" on audit_log for select to authenticated using (is_curator());
create policy "curator write audit" on audit_log for insert to authenticated with check (is_curator());
