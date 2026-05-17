const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  bracket_channel_id TEXT,
  staff_role_id TEXT,
  match_category_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  team_size INTEGER NOT NULL,
  format TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'registration',
  current_round INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  bracket_channel_id TEXT,
  signup_channel_id TEXT,
  checkin_channel_id TEXT,
  match_category_id TEXT,
  staff_role_id TEXT,
  auto_match_channels INTEGER DEFAULT 0,
  auto_voice INTEGER DEFAULT 0,
  auto_archive INTEGER DEFAULT 0,
  require_checkin INTEGER DEFAULT 0,
  registration_role_id TEXT,
  cleanup_roles INTEGER DEFAULT 0,
  winner_team_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  players_json TEXT NOT NULL,
  checked_in INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tournament_id, name)
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL,
  round INTEGER NOT NULL,
  match_number INTEGER NOT NULL,
  team1_id INTEGER,
  team2_id INTEGER,
  winner_team_id INTEGER,
  reported_winner_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  bracket_group TEXT DEFAULT 'winners',
  text_channel_id TEXT,
  voice_channel_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT,
  tournament_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

for (const [col, def] of [
  ['bracket_channel_id', 'TEXT'], ['signup_channel_id', 'TEXT'], ['checkin_channel_id', 'TEXT'],
  ['match_category_id', 'TEXT'], ['staff_role_id', 'TEXT'], ['auto_match_channels', 'INTEGER DEFAULT 0'],
  ['auto_voice', 'INTEGER DEFAULT 0'], ['auto_archive', 'INTEGER DEFAULT 0'], ['require_checkin', 'INTEGER DEFAULT 0'], ['registration_role_id', 'TEXT'], ['cleanup_roles', 'INTEGER DEFAULT 0'], ['winner_team_id', 'INTEGER']
]) ensureColumn('tournaments', col, def);
for (const [col, def] of [['text_channel_id', 'TEXT'], ['voice_channel_id', 'TEXT'], ['bracket_group', "TEXT DEFAULT 'winners'"]]) ensureColumn('matches', col, def);

function log(guildId, tournamentId, action, details='') {
  db.prepare('INSERT INTO logs (guild_id,tournament_id,action,details) VALUES (?,?,?,?)').run(guildId, tournamentId, action, details);
}

module.exports = { db, log };
