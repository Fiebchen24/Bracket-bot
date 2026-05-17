const { db, log } = require('./database');

function parseTeam(t) { return t ? { ...t, players: JSON.parse(t.players_json) } : null; }

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
function getActiveTournaments(guildId) {
  return db.prepare(`SELECT * FROM tournaments WHERE guild_id=? AND status IN ('registration','running','paused') ORDER BY id DESC`).all(guildId);
}
function getLatestTournament(guildId) {
  return db.prepare(`SELECT * FROM tournaments WHERE guild_id=? ORDER BY id DESC LIMIT 1`).get(guildId);
}
function getTournamentById(id) {
  return db.prepare('SELECT * FROM tournaments WHERE id=?').get(id);
}
function getTournamentForChannel(guildId, channelId, statuses = ['registration','running','paused']) {
  const placeholders = statuses.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM tournaments WHERE guild_id=? AND status IN (${placeholders}) AND (signup_channel_id=? OR bracket_channel_id=? OR checkin_channel_id=?) ORDER BY id DESC LIMIT 1`).get(guildId, ...statuses, channelId, channelId, channelId);
}
function getTournamentForSignupChannel(guildId, channelId) {
  return db.prepare(`SELECT * FROM tournaments WHERE guild_id=? AND signup_channel_id=? AND status='registration' ORDER BY id DESC LIMIT 1`).get(guildId, channelId);
}
function getTournamentForCheckinChannel(guildId, channelId) {
  return db.prepare(`SELECT * FROM tournaments WHERE guild_id=? AND (checkin_channel_id=? OR signup_channel_id=?) AND status='registration' ORDER BY id DESC LIMIT 1`).get(guildId, channelId, channelId);
}
function getTournamentForBracketChannel(guildId, channelId) {
  return db.prepare(`SELECT * FROM tournaments WHERE guild_id=? AND bracket_channel_id=? AND status IN ('registration','running','paused') ORDER BY id DESC LIMIT 1`).get(guildId, channelId);
}
function createTournament(data) {
  const info = db.prepare(`INSERT INTO tournaments (
    guild_id,name,team_size,format,created_by,bracket_channel_id,signup_channel_id,checkin_channel_id,match_category_id,staff_role_id,auto_match_channels,auto_voice,auto_archive,require_checkin,registration_role_id,cleanup_roles
  ) VALUES (@guildId,@name,@teamSize,@format,@createdBy,@bracketChannelId,@signupChannelId,@checkinChannelId,@matchCategoryId,@staffRoleId,@autoMatchChannels,@autoVoice,@autoArchive,@requireCheckin,@registrationRoleId,@cleanupRoles)`).run(data);
  log(data.guildId, info.lastInsertRowid, 'TOURNAMENT_CREATED', `${data.name} ${data.teamSize}v${data.teamSize} ${data.format}`);
  return getTournamentById(info.lastInsertRowid);
}
function updateTournament(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map(k => `${k}=@${k}`).join(', ');
  db.prepare(`UPDATE tournaments SET ${set}, updated_at=CURRENT_TIMESTAMP WHERE id=@id`).run({ id, ...fields });
}
function resetTournament(guildId, id = null) {
  const t = id ? getTournamentById(id) : getActiveTournament(guildId);
  if (!t || t.guild_id !== guildId) return null;
  updateTournament(t.id, { status: 'ended' });
  log(guildId, t.id, 'TOURNAMENT_RESET', 'Tournament ended/reset');
  return t;
}
function addTeam(tournamentId, name, players, checkedIn = 0) {
  const info = db.prepare('INSERT INTO teams (tournament_id,name,players_json,checked_in) VALUES (?,?,?,?)').run(tournamentId, name, JSON.stringify(players), checkedIn ? 1 : 0);
  return getTeam(info.lastInsertRowid);
}
function getTeams(tournamentId) {
  return db.prepare('SELECT * FROM teams WHERE tournament_id=? AND active=1 ORDER BY id ASC').all(tournamentId).map(parseTeam);
}
function getTeam(id) { return parseTeam(db.prepare('SELECT * FROM teams WHERE id=?').get(id)); }
function updateTeam(id, fields) {
  const keys = Object.keys(fields); if (!keys.length) return;
  const set = keys.map(k => `${k}=@${k}`).join(', ');
  db.prepare(`UPDATE teams SET ${set} WHERE id=@id`).run({ id, ...fields });
}
function createMatch(tournamentId, round, matchNumber, team1Id, team2Id, status='pending', winnerTeamId=null, bracketGroup='winners') {
  const info = db.prepare('INSERT INTO matches (tournament_id,round,match_number,team1_id,team2_id,status,winner_team_id,bracket_group) VALUES (?,?,?,?,?,?,?,?)').run(tournamentId, round, matchNumber, team1Id, team2Id, status, winnerTeamId, bracketGroup);
  return getMatch(info.lastInsertRowid);
}
function getMatches(tournamentId) {
  return db.prepare('SELECT * FROM matches WHERE tournament_id=? ORDER BY round ASC, match_number ASC').all(tournamentId);
}
function getMatch(id) { return db.prepare('SELECT * FROM matches WHERE id=?').get(id); }
function updateMatch(id, fields) {
  const keys = Object.keys(fields); if (!keys.length) return;
  const set = keys.map(k => `${k}=@${k}`).join(', ');
  db.prepare(`UPDATE matches SET ${set}, updated_at=CURRENT_TIMESTAMP WHERE id=@id`).run({ id, ...fields });
}
function getRoundMatches(tournamentId, round, bracketGroup = null) {
  if (bracketGroup) return db.prepare('SELECT * FROM matches WHERE tournament_id=? AND round=? AND bracket_group=? ORDER BY match_number ASC').all(tournamentId, round, bracketGroup);
  return db.prepare('SELECT * FROM matches WHERE tournament_id=? AND round=? ORDER BY match_number ASC').all(tournamentId, round);
}
function getGroupRoundMatches(tournamentId, bracketGroup, round) { return getRoundMatches(tournamentId, round, bracketGroup); }
function getLogs(tournamentId, limit = 50) { return db.prepare('SELECT * FROM logs WHERE tournament_id=? ORDER BY id DESC LIMIT ?').all(tournamentId, limit); }
function getOpenMatchesWithChannels(tournamentId) { return db.prepare(`SELECT * FROM matches WHERE tournament_id=? AND status IN ('pending','reported')`).all(tournamentId); }

module.exports = {
  getSettings, upsertSettings, getActiveTournament, getActiveTournaments, getLatestTournament, getTournamentById,
  getTournamentForChannel, getTournamentForSignupChannel, getTournamentForCheckinChannel, getTournamentForBracketChannel,
  createTournament, updateTournament, resetTournament, addTeam, getTeams, getTeam, updateTeam, createMatch, getMatches,
  getMatch, updateMatch, getRoundMatches, getGroupRoundMatches, getOpenMatchesWithChannels, getLogs, log
};
