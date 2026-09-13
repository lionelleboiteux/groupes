/**
 * groupes.fantasy-coach.fr — sync worker.
 *
 * Standalone Apps Script (deliberately NOT container-bound) that watches
 * the "Groupes" tab of the "Compos L1 - Saison 26-27" spreadsheet — shared
 * with the sibling compos project so the teammate keeps editing everything
 * in one familiar file; see that repo's apps-script/Code.gs's
 * setupGroupesTab for the one-time tab creation/prefill — and mirrors
 * edited rows into the `groupes` table of PRONOS' Supabase project (see
 * ../supabase/migration.sql), so this project's static frontend can read
 * them directly via PostgREST. Never touches compos's own Code.gs, doGet,
 * or Web App deployment.
 *
 * The "Groupes" tab columns (row 1 header, data from row 2): Gameweek |
 * Équipe | Image URL. `Équipe` must match a `teams.name` value in pronos'
 * database for that row to sync — an unmatched name is logged and skipped,
 * never written with a made-up team_id.
 */

// The "Compos L1 - Saison 26-27" spreadsheet's ID (from its URL:
// docs.google.com/spreadsheets/d/<THIS>/edit). This script is standalone,
// not bound to that spreadsheet, so it has no other way to find it.
var SPREADSHEET_ID = '1PB9ksJUx8toD_NcFzPGtVeXJfdjwYxkrY_9pBP-N9VY';
var SHEET_NAME = 'Groupes';

// pronos' own Supabase project (same one compos/DNP's frontends already
// call for the current-gameweek API) — see pronos/db/migrations/
// 0001_initial_schema.sql for the `teams` table this joins against.
var SUPABASE_URL = 'https://dmytkubjxwwwkroutvdu.supabase.co';

// The "Groupes" tab's Équipe column uses the same short club names as the
// sibling "Compos" tab (e.g. "Paris SG", "Brest") — friendlier for manual
// entry than pronos' teams.name, which stores full official names (e.g.
// "Paris Saint-Germain", "Stade Brestois 29"); confirmed directly against
// pronos' live `teams` table — only "Paris FC" happens to match as-is, the
// other 17 don't. Same class of short-name/canonical-name mismatch
// compos's own mapApiTeamName_ already solves for ligue1.com's API names.
// Update this whenever a team is promoted/relegated (same gotcha compos's
// README documents for its own TEAM_LOGOS map).
var TEAM_NAME_TO_PRONOS_NAME = {
  'Angers': 'Angers SCO',
  'Auxerre': 'AJ Auxerre',
  'Brest': 'Stade Brestois 29',
  'Le Havre': 'Havre Athletic Club',
  'Le Mans': 'Le Mans FC',
  'Lens': 'RC Lens',
  'Lille': 'LOSC Lille',
  'Lorient': 'FC Lorient',
  'Lyon': 'Olympique Lyonnais',
  'Marseille': 'Olympique de Marseille',
  'Monaco': 'AS Monaco',
  'Nice': 'OGC Nice',
  'Paris FC': 'Paris FC',
  'Paris SG': 'Paris Saint-Germain',
  'Rennes': 'Stade Rennais FC',
  'Strasbourg': 'RC Strasbourg Alsace',
  'Toulouse': 'Toulouse FC',
  'Troyes': 'Estac Troyes'
};

/**
 * Installable onEdit handler (see setupGroupesSyncTrigger below for why
 * this can't be a simple onEdit trigger). Re-syncs the whole tab on any
 * edit to it, not just the touched row — the tab is small (currently 4
 * gameweeks x 18 teams) and every row is independently upserted by its own
 * (team_id, gameweek) key, so a full pass costs one Supabase round trip and
 * is simpler and more robust than diffing e.range by hand.
 */
function onGroupesEdit_(e) {
  if (e && e.range && e.range.getSheet().getName() !== SHEET_NAME) return;
  syncGroupesTab_();
}

function syncGroupesTab_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('No "' + SHEET_NAME + '" tab found in spreadsheet ' + SPREADSHEET_ID);

  var values = sheet.getDataRange().getValues(); // [ [Gameweek, Équipe, Image URL], ... ]
  var rows = values.slice(1).filter(function (r) { return r[0] && r[1] && r[2]; });

  var teamIdByName = fetchTeamIdByName_();
  var upserts = [];
  var skipped = [];
  rows.forEach(function (r) {
    var gameweek = Number(r[0]);
    var teamName = String(r[1]).trim();
    var imageUrl = String(r[2]).trim();
    var pronosName = TEAM_NAME_TO_PRONOS_NAME[teamName] || teamName;
    var teamId = teamIdByName[pronosName];
    if (!teamId) {
      skipped.push(teamName);
      return;
    }
    // team_name stores the sheet's own short name (not pronosName) so the
    // frontend keeps displaying "Paris SG"/"Brest" etc., matching the
    // sibling sites' convention — only the FK lookup above needs the
    // canonical pronos name.
    upserts.push({ team_id: teamId, team_name: teamName, gameweek: gameweek, image_url: imageUrl });
  });

  if (skipped.length) {
    Logger.log('Skipped rows with no TEAM_NAME_TO_PRONOS_NAME mapping (or no matching teams.name in pronos): ' + Array.from(new Set(skipped)).join(', '));
  }
  if (!upserts.length) return;

  upsertGroupes_(upserts);
}

function fetchTeamIdByName_() {
  var resp = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/teams?select=id,name', {
    method: 'get',
    headers: supabaseHeaders_(),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Failed to fetch teams from pronos: ' + resp.getResponseCode() + ' ' + resp.getContentText());
  }
  var teams = JSON.parse(resp.getContentText());
  var map = {};
  teams.forEach(function (t) { map[t.name] = t.id; });
  return map;
}

function upsertGroupes_(rows) {
  var resp = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/groupes?on_conflict=team_id,gameweek', {
    method: 'post',
    headers: Object.assign({ Prefer: 'resolution=merge-duplicates' }, supabaseHeaders_()),
    contentType: 'application/json',
    payload: JSON.stringify(rows),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) {
    throw new Error('Supabase upsert into groupes failed: ' + resp.getResponseCode() + ' ' + resp.getContentText());
  }
  Logger.log('Synced ' + rows.length + ' groupes row(s) to Supabase.');
}

function supabaseHeaders_() {
  var key = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY script property — see README setup step 3.');
  return {
    apikey: key,
    Authorization: 'Bearer ' + key
  };
}

/**
 * One-time setup: run once from the Apps Script editor (after setting
 * SPREADSHEET_ID above and the SUPABASE_SERVICE_ROLE_KEY script property —
 * see README) to install the installable onEdit trigger this standalone
 * script needs — a simple onEdit trigger only fires for a script that's
 * container-bound to the spreadsheet, which this one deliberately isn't
 * (see the top-of-file comment on why). Re-running is safe: clears any
 * trigger it previously installed for onGroupesEdit_ first, so triggers
 * never stack up.
 */
function setupGroupesSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onGroupesEdit_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onGroupesEdit_')
    .forSpreadsheet(SPREADSHEET_ID)
    .onEdit()
    .create();
}

/**
 * One-off backfill: run once by hand right after setup to push every
 * existing row immediately instead of waiting for the next edit. Safe to
 * re-run any time — every row is upserted by (team_id, gameweek).
 */
function backfillGroupes() {
  syncGroupesTab_();
}
