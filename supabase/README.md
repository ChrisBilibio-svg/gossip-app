# Supabase (database as code)

This folder holds the database schema as version-controlled SQL migrations.

- `migrations/` — ordered `.sql` files. `0000_init.sql` enables extensions; later
  stories add tables (rumors, predictions, comments, …) as they need them.

## Applying migrations (v1, simple workflow)

Until the Supabase CLI is set up, apply a migration by pasting its SQL into the
**Supabase dashboard → SQL Editor → Run**. Run them in filename order.

Later (recommended once comfortable): install the Supabase CLI and use
`supabase db push` to apply `migrations/` automatically.

## Rules

- One change per migration; never edit an already-applied migration — add a new one.
- Tables, RLS policies, and functions all live here so the schema is reproducible.
