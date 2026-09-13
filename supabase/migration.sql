-- groupes.fantasy-coach.fr — "Groupes" table.
--
-- This lives inside PRONOS' Supabase project (not a separate project), so
-- it can carry a real foreign key into pronos' own `teams` table instead of
-- a hand-maintained, duplicated team list (the approach the sibling compos
-- project uses for its TEAM_LOGOS map). Apply this against pronos'
-- Supabase project (SQL editor, or as a migration in that repo's own
-- db/migrations/ following its numbering convention) — it is NOT applied
-- automatically by anything in this repo.
--
-- `team_name` is a deliberate denormalization, not an oversight: pronos'
-- own 0001_initial_schema.sql enables RLS with zero anon/authenticated
-- policies on every existing table (including `teams`) by design — "every
-- read and write goes through an Edge Function", see that migration's own
-- comment above its RLS block. Embedding `teams(name)` via PostgREST from
-- this table would silently come back empty for an anonymous caller
-- because the embedded row is itself subject to `teams`' own (policy-less)
-- RLS. Storing team_name directly on `groupes` lets the public frontend
-- read a human-readable name without needing any policy change on `teams`
-- itself — every other table in pronos' database stays exactly as locked
-- down as it is today.
create table if not exists groupes (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  team_name text not null,
  gameweek int not null,
  image_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, gameweek)
);

alter table groupes enable row level security;

-- Scoped, deliberate exception to pronos' "no direct PostgREST access"
-- convention — see the comment above. This table holds only public,
-- non-sensitive reference data (an image URL per team per gameweek, once
-- set it never changes), so it alone gets a narrow anon/authenticated
-- SELECT policy instead of requiring a new Edge Function route. There is
-- deliberately no insert/update/delete policy for anon/authenticated —
-- all writes come from apps-script/Code.gs's service_role key (Script
-- Properties, never shipped to the frontend), which bypasses RLS entirely,
-- same as every Edge Function already does for every other table.
create policy "groupes public read access"
  on groupes
  for select
  to anon, authenticated
  using (true);
