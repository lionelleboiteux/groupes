# Groupes — Photos de Groupe (Ligue 1)

A page, separate from the Wix-hosted fantasy-coach.fr, showing — for a
selected journée and team — the group photo each Ligue 1 club publishes
before its matchday, one team per card (or one big card when a specific
team is picked). Replaces the old `fantasy-coach.fr/groupes` Wix page.

Same $0 hosting pattern as the sibling projects
[`pronos`](../pronos) (`pronos.fantasy-coach.fr`),
[`DNP`](../DNP) (`l1.dnp.fantasy-coach.fr`) and
[`compos`](../compos) (`l1.compos.fantasy-coach.fr`): a static page deployed
via GitHub Actions to GitHub Pages, on its own subdomain of
fantasy-coach.fr.

## Architecture — and why it differs from DNP/compos

DNP and compos each front their own Google Sheet with an Apps Script Web
App, cached at the edge by a Cloudflare Worker + KV, because their data
changes shape and needs revalidating. This project's data is much simpler —
a stable `(team, gameweek) → image URL` lookup that, once written, never
changes — so the shape here is intentionally leaner:

```
"Groupes" tab, inside the EXISTING "Compos L1 - Saison 26-27" Sheet
      |  (teammate edits this exactly like the "Compos" tab — same
      |   spreadsheet, same habits, nothing new to learn)
      |
      v  onEdit (installable trigger, this repo's own standalone script)
apps-script/Code.gs  --------------------------->  pronos' Supabase project
                          upsert via REST,             `groupes` table
                          service_role key              (see supabase/migration.sql)
                                                          |
                                                          | PostgREST, anon key,
                                                          | narrow public-SELECT policy
                                                          v
                                              frontend/index.html (static,
                                              GitHub Pages, groupes.fantasy-coach.fr)
```

Two deliberate departures from the DNP/compos shape:

- **No Cloudflare Worker/KV cache.** DNP and compos already share
  Cloudflare's account-wide free-tier cap of 1,000 KV writes/day; compos's
  own README documents real pain working around it. This data is written
  at most a few times a week and is immutable once set, so reading straight
  from Supabase's PostgREST sidesteps that shared bottleneck instead of
  adding a third consumer to it.
- **The `groupes` table lives inside PRONOS' Supabase project**, not a new
  one, so it can carry a real foreign key into pronos' own `teams` table
  instead of a hand-maintained, duplicated team list (the approach compos
  uses for its `TEAM_LOGOS` map). See `supabase/migration.sql` for why
  `team_name` is *also* stored directly on the row (denormalized on
  purpose) rather than relying on a PostgREST embed of `teams` — pronos
  locks every other table down to zero direct anon/authenticated access by
  design, and an embed would silently come back empty for an anonymous
  frontend request.

Apps Script here is standalone, not container-bound to the spreadsheet
(unlike DNP/compos's own scripts, which *are* bound to their respective
sheets) — it only needs to read/write that one spreadsheet by ID and sync
to Supabase, it never serves a Web App, so nothing about it needs to be
attached to the Sheet itself. That also means it never touches, and can't
break, compos's own bound script or its live Web App deployment.

## Setup

### 1. The "Groupes" tab already exists (or: how to create it)

The "Groupes" tab (Gameweek | Équipe | Image URL, one row per team per
gameweek) lives inside the same "Compos L1 - Saison 26-27" spreadsheet the
sibling [`compos`](../compos) project uses. A `setupGroupesTab()` function
has already been added to **that** repo's `apps-script/Code.gs` and pushed
via `clasp push` — it does **not** touch compos's own `doGet`, `onEdit`, or
Web App deployment, it only adds a brand new, self-contained function. (No
trailing underscore, unlike this codebase's usual `_`-suffixed-helper
convention — the Apps Script editor's function dropdown hides any function
whose name ends in `_`, so anything meant to be run by hand from that
dropdown has to be named without one.)

To actually create the tab:

1. Open the "Compos L1 - Saison 26-27" spreadsheet, Extensions > Apps
   Script (this opens compos's own bound script project).
2. In the function dropdown, select `setupGroupesTab` and click **Run**
   (grant permissions if prompted). Safe to re-run — it no-ops if the
   "Groupes" tab already exists.
3. This creates the tab prefilled with 72 rows (18 teams x journées 1-4),
   recovered from the old Wix CMS's `Groupes` data collection. A handful of
   cells are deliberately blank — those are teams/gameweeks that had no
   group photo at all in the Wix source (mostly J04, which was still in
   progress when this was pulled on 2026-09-13). Rows that carried Wix's
   own shared "Pas de groupe" placeholder graphic keep that same image
   (resolved to its `static.wixstatic.com` URL) rather than being left
   blank, since that was a deliberate "no photo this week" graphic, not
   missing data — fill in real ones as they become available, or leave
   as-is.
4. From here on, the teammate edits this tab exactly like "Compos" — plain
   spreadsheet editing, nothing new to learn.

### 2. Create the pronos-side database objects

Apply `supabase/migration.sql` against **pronos' Supabase project** (not a
new project) — either via that project's SQL editor, or by adding it as a
migration in the pronos repo's own `db/migrations/` following its existing
numbering convention. This repo doesn't apply it automatically: pronos is
a separately governed codebase and this migration is deliberately handed
over as a file rather than run against its database directly.

This creates the `groupes` table (FK to `teams`, unique on
`(team_id, gameweek)`) and a narrow public-SELECT RLS policy scoped to just
this one new table — every other pronos table stays exactly as locked down
as it is today (see the migration file's own comments for why).

### 3. Set up this project's standalone Apps Script

This is a **separate** Apps Script project from compos's — standalone, not
bound to any spreadsheet, since it only needs to read/write the "Compos L1"
sheet by ID and call Supabase.

The project already exists — created via `clasp create --type standalone`
and pushed via `clasp push`, script ID
`1Y1rj-fzn1gfnrY-oPDmuUnNDnFmEIi74-Q4-oEB9dbq7ywUYF3pSDH9r`
([open it](https://script.google.com/d/1Y1rj-fzn1gfnrY-oPDmuUnNDnFmEIi74-Q4-oEB9dbq7ywUYF3pSDH9r/edit)),
with `apps-script/Code.gs` + `appsscript.json` already in place and
`SPREADSHEET_ID` already pointing at "Compos L1 - Saison 26-27". This
repo's own `apps-script/.clasp.json` (gitignored, not committed) points at
it, so future edits can go out via `clasp push` from `apps-script/` — same
pattern as the sibling DNP/compos projects. Remaining steps, all manual by
design (no Apps Script API exists for setting Script Properties or running
a function from outside the editor without extra per-project GCP/Execution
API wiring this project doesn't need):

1. Open the project (link above).
2. **Project Settings > Script Properties > Add script property**:
   `SUPABASE_SERVICE_ROLE_KEY` = the pronos Supabase project's
   `service_role` key (Project Settings > API in that Supabase project —
   **never** the anon/publishable key here, this one bypasses RLS and must
   stay server-side only).
3. In the function dropdown, select `setupGroupesSyncTrigger` and click
   **Run** once (grant the requested permissions — it needs to manage
   triggers and read/write the spreadsheet by ID). Re-running later is
   safe; it clears any trigger it previously installed first.
4. Select `backfillGroupes` in the function dropdown and click **Run** once
   to push the prefilled rows from step 1 into Supabase immediately,
   instead of waiting for the next edit.

#### Managing this script with clasp

Already set up (see above) — `apps-script/.clasp.json` (gitignored) points
at the live project, so after editing `Code.gs` or `appsscript.json`:

```bash
cd apps-script
clasp push                      # uploads Code.gs + appsscript.json
```

Same clasp setup and gotchas as the sibling DNP/compos projects — see
compos's README for the full writeup (executeAs identity issues, the
Apps Script API needing to be enabled once per account, etc.); mostly
irrelevant here since this script has no Web App deployment to worry about.

### 4. Point the frontend at pronos' Supabase project

Already done — `frontend/index.html`'s `SUPABASE_ANON_KEY` is set to
pronos' `sb_publishable_...` key (the modern, non-JWT format Supabase now
recommends over the legacy anon JWT for new client-side code; fetched via
`supabase projects api-keys --project-ref dmytkubjxwwwkroutvdu`).
`SUPABASE_URL` is already set to that project's URL (the same one
compos/DNP's frontends already call for the current-gameweek API). This
key is meant to be exposed client-side — Supabase's publishable/anon key is
public by design; `groupes`' own RLS policy is what actually scopes access
to read-only (see `supabase/migration.sql`).

(For local testing without editing the file, append `?api=<url>` to the
page's own URL to override `SUPABASE_URL` — same convention as the sibling
projects.)

### 5. Host it

1. Create a GitHub repo for this directory (e.g.
   `lionelleboiteux/groupes`, public — GitHub Pages on the free tier
   requires a public repo), push `main`.
2. Repo Settings > Pages > Source: **GitHub Actions** (the included
   `.github/workflows/pages.yml` handles the rest on every push to `main`).
3. Add a DNS **CNAME** record: `groupes` → `<your-github-username>.github.io`
   (same pattern as `l1.dnp`/`l1.compos`).
4. Once DNS propagates and a deploy has run,
   https://groupes.fantasy-coach.fr should serve the page.

### 6. Wire up the shared nav

[`fc-shared`](../fc-shared)'s `nav.js` already has a "Groupes" entry in its
`LINKS` array (pointing at the old Wix URL) — once this site is actually
live at its own subdomain, update that entry's `url` (and give it an `id`,
e.g. `groupes`) to point here instead, then push to `fc-shared`'s `main`.
That repo's edits go live on every sibling site's next page load (jsDelivr
caches the `@main` ref for ~12h), so this is deliberately left as a
separate, later step rather than done as part of this scaffold — no point
pointing production nav at a subdomain that isn't live yet.

## Notes

- **Team name matching**: pronos' `teams.name` stores full official club
  names ("Paris Saint-Germain", "Stade Brestois 29"), not the short names
  the "Groupes"/"Compos" tabs use ("Paris SG", "Brest") — confirmed
  directly against the live table; 17 of the 18 Ligue 1 short names don't
  match as-is, only "Paris FC" does. `TEAM_NAME_TO_PRONOS_NAME` in
  `Code.gs` translates between them (same class of problem, same shape of
  fix, as compos's own `mapApiTeamName_`) — update it whenever a team is
  promoted/relegated. A row whose `Équipe` has no entry in that map (and
  doesn't happen to match a `teams.name` verbatim) is logged and skipped
  (see `syncGroupesTab_`'s `skipped` list in the Apps Script executions
  log), never written with a guessed team.
- **"Toutes les équipes" default**: the team dropdown always starts on its
  blank first option (all teams); only the gameweek picker defaults to a
  computed value (the current gameweek per the pronos API, falling back to
  the latest gameweek that actually has data).
- **Dropdowns are data-driven**: both the gameweek and team lists come from
  whatever's actually already in the `groupes` table (`select=gameweek,
  team_name`), not a hardcoded Ligue 1 fixture list or team roster — a
  journée or a team only appears once at least one row exists for it.
- **Caching**: deliberately none beyond the browser's own HTTP cache — see
  "Architecture" above for why this project skips the Worker/KV layer
  DNP/compos use.
