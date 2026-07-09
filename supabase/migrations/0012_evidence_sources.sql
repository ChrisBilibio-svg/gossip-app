-- 0012_evidence_sources.sql — Evidence sources for evidence-first resolution
--
-- Tracks the credible links curators use to confirm or debunk a rumor. This
-- makes the evidence-first model reviewable instead of relying on a single
-- source_url field or private curator judgment.

create table if not exists rumor_evidence_sources (
  id          uuid primary key default gen_random_uuid(),
  rumor_id    uuid not null references rumors (id) on delete cascade,
  source_url  text not null,
  source_label text,
  supports_outcome boolean not null, -- true = supports TEA/confirmed, false = supports CAP/debunked
  note        text,
  created_by  uuid references auth.users (id) default auth.uid(),
  created_at  timestamptz not null default now()
);

create index if not exists rumor_evidence_sources_rumor_idx
  on rumor_evidence_sources (rumor_id, created_at desc);

alter table rumor_evidence_sources enable row level security;

-- Public readers may see evidence only for non-draft, already-published rumors.
create policy "read published rumor evidence"
  on rumor_evidence_sources for select
  to anon, authenticated
  using (
    exists (
      select 1
      from rumors r
      where r.id = rumor_evidence_sources.rumor_id
        and r.publish_at <= now()
        and coalesce(r.is_draft, false) = false
    )
  );

-- Curators add/remove evidence while reviewing a rumor.
create policy "curator read all evidence"
  on rumor_evidence_sources for select
  to authenticated
  using (is_curator());

create policy "curator insert evidence"
  on rumor_evidence_sources for insert
  to authenticated
  with check (is_curator());

create policy "curator update evidence"
  on rumor_evidence_sources for update
  to authenticated
  using (is_curator());

create policy "curator delete evidence"
  on rumor_evidence_sources for delete
  to authenticated
  using (is_curator());

create or replace function evidence_count_for_outcome(p_rumor_id uuid, p_outcome boolean)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer
  from rumor_evidence_sources
  where rumor_id = p_rumor_id
    and supports_outcome = p_outcome;
$$;

revoke all on function evidence_count_for_outcome(uuid, boolean) from public;

create or replace function resolve_rumor_with_evidence(p_rumor_id uuid, p_outcome boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rumor rumors;
  v_count integer;
begin
  if auth.uid() is not null and not is_curator() then
    raise exception 'not a curator';
  end if;

  select * into v_rumor from rumors where id = p_rumor_id for update;
  if not found then raise exception 'rumor not found'; end if;

  if v_rumor.resolution_policy = 'evidence' then
    select evidence_count_for_outcome(p_rumor_id, p_outcome) into v_count;
    if v_count < v_rumor.required_source_count then
      raise exception 'need % credible evidence sources for this outcome; found %', v_rumor.required_source_count, v_count;
    end if;
  end if;

  perform resolve_rumor(p_rumor_id, p_outcome);

  update rumors
  set resolution_reason = case
    when v_rumor.resolution_policy = 'evidence' then 'credible_sources_threshold_met'
    else resolution_reason
  end
  where id = p_rumor_id;

  insert into audit_log (actor_id, action, rumor_id, detail)
  values (
    auth.uid(),
    'resolve_with_evidence',
    p_rumor_id,
    jsonb_build_object(
      'outcome', p_outcome,
      'evidence_count', coalesce(v_count, 0),
      'required_source_count', v_rumor.required_source_count,
      'resolution_policy', v_rumor.resolution_policy
    )
  );
end;
$$;

grant execute on function resolve_rumor_with_evidence(uuid, boolean) to authenticated;
