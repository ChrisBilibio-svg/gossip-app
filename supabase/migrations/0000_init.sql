-- 0000_init.sql — Foundation migration (Story 1.1)
-- Enables the extensions later migrations rely on. No tables yet —
-- each table is created by the story that first needs it (rumors → Story 1.5,
-- predictions → Story 2.1, comments → Epic 4, etc.).

-- UUID + crypto helpers. Supabase ships these ready; gen_random_uuid() is also
-- built into Postgres 13+ core, so no extension is strictly required.
create extension if not exists "pgcrypto";
