const { db, log } = require('./database');

function getSettings(guildId) {
  return db.prepare('SELECT * FROM guild_settings WHERE guild_id=?').get(guildId);
}
function upsertSettings(guildId, data) {
  db.prepare(`INSERT INTO guild_settings (guild_id, bracket_channel_id, staff_role_id, match_category_id, updated_at)
    VALUES (@guildId,@bracketChannelId,@staffRoleId,@matchCategoryId,CURRENT_TIMESTAMP)
    ON CONFLICT(guild_id) DO UPDATE SET bracket_channel_id=@bracketChannelId, staff_role_id=@staffRoleId, match_category_id=@matchCategoryId, updated_at=CURRENT_TIMESTAMP`).run({ guildId, ...data });
}
function getActiveTournament(guildId) {
  return db.prepare(`SELECT * FROM tournaments WHERE guild_id=? AND status IN ('registration','running','paused') ORDER BY id DESC LIMIT 1`).get(guildId);
}
function createTournament(guildId, name, teamSize, format, createdBy) {
  const info = db.prepare('INSERT INTO tournaments (guild_id,name,team_size,format,created_by) VALUES (?,?,?,?,?)').run(guildId, name, teamSize, format, createdBy);
  log(guildId, info.lastInsertRowid, 'TOURNAMENT_CREATED', `${name} ${teamSize}v${teamSize} ${format}`);
  return db.prepare('SELECT * FROM tournaments WHERE id=?').get(info.lastInsertRowid);
}
function updateTournament(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map(k => `${k}=@${k}`).join(', ');
  db.prepare(`UPDATE tournaments SET ${set}, updated_at=CURRENT_TIMESTAMP WHERE id=@id`).run({ id, ...fields });
}
function resetTournament(guildId) {
  const t = getActiveTournament(guildId);
  if (!t) return null;
  updateTournament(t.id, { status: 'ended' });
  log(guildId, t.id, 'TOURNAMENT_RESET', 'Tournament ended/reset');
  return t;
}
function addTeam(tournamentId, name, players) {
  const info = db.prepare('INSERT INTO teams (tournament_id,name,players_json) VALUES (?,?,?)').run(tournamentId, name, JSON.stringify(players));
  return db.prepare('SELECT * FROM teams WHERE id=?').get(info.lastInsertRowid);
}
function getTeams(tournamentId) {
  return db.prepare('SELECT * FROM teams WHERE tournament_id=? AND active=1 ORDER BY id ASC').all(tournamentId).map(t => ({...t, players: JSON.parse(t.players_json)}));
}
function getTeam(id) {
  const t = db.prepare('SELECT * FROM teams WHERE id=?').get(id);
  return t ? {...t, players: JSON.parse(t.players_json)} : null;
}
function createMatch(tournamentId, round, matchNumber, team1Id, team2Id, status='pending', winnerTeamId=null) {
  const info = db.prepare('INSERT INTO matches (tournament_id,round,match_number,team1_id,team2_id,status,winner_team_id) VALUES (?,?,?,?,?,?,?)').run(tournamentId, round, matchNumber, team1Id, team2Id, status, winnerTeamId);
  return db.prepare('SELECT * FROM matches WHERE id=?').get(info.lastInsertRowid);
}
function getMatches(tournamentId) {
  return db.prepare('SELECT * FROM matches WHERE tournament_id=? ORDER BY round ASC, match_number ASC').all(tournamentId);
}
function getMatch(id) { return db.prepare('SELECT * FROM matches WHERE id=?').get(id); }
function updateMatch(id, fields) {
  const keys = Object.keys(fields);
  const set = keys.map(k => `${k}=@${k}`).join(', ');
  db.prepare(`UPDATE matches SET ${set}, updated_at=CURRENT_TIMESTAMP WHERE id=@id`).run({ id, ...fields });
}
function getRoundMatches(tournamentId, round) { return db.prepare('SELECT * FROM matches WHERE tournament_id=? AND round=? ORDER BY match_number ASC').all(tournamentId, round); }

module.exports = { getSettings, upsertSettings, getActiveTournament, createTournament, updateTournament, resetTournament, addTeam, getTeams, getTeam, createMatch, getMatches, getMatch, updateMatch, getRoundMatches, log };
