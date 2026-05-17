const { Pool } = require('pg');
const config = require('../config');

if (!config.databaseUrl) {
  console.warn('DATABASE_URL is not set. Create a Render PostgreSQL database and add DATABASE_URL to both Web Service and Worker.');
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseUrl && !config.databaseUrl.includes('localhost') ? { rejectUnauthorized: false } : false
});

let initPromise = null;
async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await pool.query(`
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  bracket_channel_id TEXT,
  staff_role_id TEXT,
  match_category_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tournaments (
  id SERIAL PRIMARY KEY,
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  players_json TEXT NOT NULL,
  checked_in INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tournament_id, name)
);

CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS logs (
  id SERIAL PRIMARY KEY,
  guild_id TEXT,
  tournament_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`);
  })();
  return initPromise;
}

async function query(sql, params = []) {
  await init();
  return pool.query(sql, params);
}

async function log(guildId, tournamentId, action, details='') {
  await query('INSERT INTO logs (guild_id,tournament_id,action,details) VALUES ($1,$2,$3,$4)', [guildId, tournamentId, action, details]);
}

module.exports = { pool, init, query, log };
