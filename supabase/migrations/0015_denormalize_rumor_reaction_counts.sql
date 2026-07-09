-- 0015_denormalize_rumor_reaction_counts.sql — Keep gossip like/dislike counts on rumors
--
-- The public feed should not aggregate rumor_reactions on every read. Store the
-- current lightweight popularity counts directly on rumors and maintain them from
-- rumor_reactions writes. Apply manually after 0014_place_bet_draft_guard.sql.

alter table rumors
  add column if not exists like_count integer not null default 0,
  add column if not exists dislike_count integer not null default 0;

update rumors r
set
  like_count = coalesce(counts.like_count, 0),
  dislike_count = coalesce(counts.dislike_count, 0)
from (
  select
    rumor_id,
    count(*) filter (where value = 1)::integer as like_count,
    count(*) filter (where value = -1)::integer as dislike_count
  from rumor_reactions
  group by rumor_id
) counts
where r.id = counts.rumor_id;

update rumors r
set like_count = 0,
    dislike_count = 0
where not exists (
  select 1 from rumor_reactions rr where rr.rumor_id = r.id
);

create index if not exists rumors_popularity_idx
  on rumors ((like_count - dislike_count) desc, created_at desc);

create or replace function bump_rumor_reaction_counts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update rumors
      set like_count = like_count + case when new.value = 1 then 1 else 0 end,
          dislike_count = dislike_count + case when new.value = -1 then 1 else 0 end
      where id = new.rumor_id;
    return new;
  elsif tg_op = 'UPDATE' then
    if old.value <> new.value then
      update rumors
        set like_count = greatest(like_count - case when old.value = 1 then 1 else 0 end + case when new.value = 1 then 1 else 0 end, 0),
            dislike_count = greatest(dislike_count - case when old.value = -1 then 1 else 0 end + case when new.value = -1 then 1 else 0 end, 0)
        where id = new.rumor_id;
    end if;
    return new;
  else
    update rumors
      set like_count = greatest(like_count - case when old.value = 1 then 1 else 0 end, 0),
          dislike_count = greatest(dislike_count - case when old.value = -1 then 1 else 0 end, 0)
      where id = old.rumor_id;
    return old;
  end if;
end;
$$;

drop trigger if exists rumor_reaction_count_ins on rumor_reactions;
drop trigger if exists rumor_reaction_count_upd on rumor_reactions;
drop trigger if exists rumor_reaction_count_del on rumor_reactions;

create trigger rumor_reaction_count_ins
after insert on rumor_reactions
for each row execute function bump_rumor_reaction_counts();

create trigger rumor_reaction_count_upd
after update on rumor_reactions
for each row execute function bump_rumor_reaction_counts();

create trigger rumor_reaction_count_del
after delete on rumor_reactions
for each row execute function bump_rumor_reaction_counts();

-- Keep the old view name as a compatibility shim while newer clients read rumors.
create or replace view rumor_reaction_summary as
select
  id as rumor_id,
  like_count,
  dislike_count
from rumors;

grant select on rumor_reaction_summary to anon, authenticated;
