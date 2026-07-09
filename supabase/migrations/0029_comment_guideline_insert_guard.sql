-- 0029_comment_guideline_insert_guard.sql — enforce comment guidelines server-side
--
-- The app already shows a one-time guidelines gate before comment creation, but
-- database policy must be the source of truth. This replaces the original broad
-- insert policy with one that only permits authenticated users who have accepted
-- the guidelines on their profile.

begin;

drop policy if exists "insert own comment" on comments;

create policy "insert own comment" on comments
for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from profiles p
    where p.id = auth.uid()
      and p.accepted_guidelines = true
  )
);

commit;
