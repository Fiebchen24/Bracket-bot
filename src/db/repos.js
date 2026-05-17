const { query, log } = require('./database');

function parseTeam(t) { return t ? { ...t, players: JSON.parse(t.players_json || '[]') } : null; }
function boolInt(v) { return v ? 1 : 0; }

async function getSettings(guildId) {
  const r = await query('SELECT * FROM guild_settings WHERE guild_id=$1', [guildId]);
  return r.rows[0] || null;
}
async function upsertSettings(guildId, data) {
  await query(`INSERT INTO guild_settings (guild_id, bracket_channel_id, staff_role_id, match_category_id, updated_at)
    VALUES ($1,$2,$3,$4,NOW())
    ON CONFLICT(guild_id) DO UPDATE SET bracket_channel_id=$2, staff_role_id=$3, match_category_id=$4, updated_at=NOW()`,
    [guildId, data.bracketChannelId || null, data.staffRoleId || null, data.matchCategoryId || null]);
}
async function getActiveTournament(guildId) {
  const r = await query(`SELECT * FROM tournaments WHERE guild_id=$1 AND status IN ('registration','running','paused') ORDER BY id DESC LIMIT 1`, [guildId]);
  return r.rows[0] || null;
}
async function getActiveTournaments(guildId) {
  const r = await query(`SELECT * FROM tournaments WHERE guild_id=$1 AND status IN ('registration','running','paused') ORDER BY id DESC`, [guildId]);
  return r.rows;
}
async function getLatestTournament(guildId) {
  const r = await query(`SELECT * FROM tournaments WHERE guild_id=$1 ORDER BY id DESC LIMIT 1`, [guildId]);
  return r.rows[0] || null;
}
async function getTournamentById(id) {
  const r = await query('SELECT * FROM tournaments WHERE id=$1', [id]);
  return r.rows[0] || null;
}
async function getTournamentForChannel(guildId, channelId, statuses = ['registration','running','paused']) {
  const r = await query(`SELECT * FROM tournaments WHERE guild_id=$1 AND status = ANY($2) AND (signup_channel_id=$3 OR bracket_channel_id=$3 OR checkin_channel_id=$3) ORDER BY id DESC LIMIT 1`, [guildId, statuses, channelId]);
  return r.rows[0] || null;
}
async function getTournamentForSignupChannel(guildId, channelId) {
  const r = await query(`SELECT * FROM tournaments WHERE guild_id=$1 AND signup_channel_id=$2 AND status='registration' ORDER BY id DESC LIMIT 1`, [guildId, channelId]);
  return r.rows[0] || null;
}
async function getTournamentForCheckinChannel(guildId, channelId) {
  const r = await query(`SELECT * FROM tournaments WHERE guild_id=$1 AND (checkin_channel_id=$2 OR signup_channel_id=$2) AND status='registration' ORDER BY id DESC LIMIT 1`, [guildId, channelId]);
  return r.rows[0] || null;
}
async function getTournamentForBracketChannel(guildId, channelId) {
  const r = await query(`SELECT * FROM tournaments WHERE guild_id=$1 AND bracket_channel_id=$2 AND status IN ('registration','running','paused') ORDER BY id DESC LIMIT 1`, [guildId, channelId]);
  return r.rows[0] || null;
}
async function createTournament(data) {
  const r = await query(`INSERT INTO tournaments (
    guild_id,name,team_size,format,created_by,bracket_channel_id,signup_channel_id,checkin_channel_id,match_category_id,staff_role_id,auto_match_channels,auto_voice,auto_archive,require_checkin,registration_role_id,cleanup_roles
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`, [
    data.guildId, data.name, data.teamSize, data.format, data.createdBy, data.bracketChannelId, data.signupChannelId,
    data.checkinChannelId || null, data.matchCategoryId || null, data.staffRoleId || null, boolInt(data.autoMatchChannels), boolInt(data.autoVoice), boolInt(data.autoArchive), boolInt(data.requireCheckin), data.registrationRoleId || null, boolInt(data.cleanupRoles)
  ]);
  const id = r.rows[0].id;
  await log(data.guildId, id, 'TOURNAMENT_CREATED', `${data.name} ${data.teamSize}v${data.teamSize} ${data.format}`);
  return getTournamentById(id);
}
async function updateTournament(id, fields) {
  const keys = Object.keys(fields); if (!keys.length) return;
  const values = keys.map(k => fields[k]);
  const set = keys.map((k,i) => `${k}=$${i+1}`).join(', ');
  await query(`UPDATE tournaments SET ${set}, updated_at=NOW() WHERE id=$${keys.length+1}`, [...values, id]);
}
async function resetTournament(guildId, id = null) {
  const t = id ? await getTournamentById(id) : await getActiveTournament(guildId);
  if (!t || t.guild_id !== guildId) return null;
  await updateTournament(t.id, { status: 'ended' });
  await log(guildId, t.id, 'TOURNAMENT_RESET', 'Tournament ended/reset');
  return t;
}
async function addTeam(tournamentId, name, players, checkedIn = 0) {
  const r = await query('INSERT INTO teams (tournament_id,name,players_json,checked_in) VALUES ($1,$2,$3,$4) RETURNING id', [tournamentId, name, JSON.stringify(players), checkedIn ? 1 : 0]);
  return getTeam(r.rows[0].id);
}
async function getTeams(tournamentId) {
  const r = await query('SELECT * FROM teams WHERE tournament_id=$1 AND active=1 ORDER BY id ASC', [tournamentId]);
  return r.rows.map(parseTeam);
}
async function getTeam(id) { const r = await query('SELECT * FROM teams WHERE id=$1', [id]); return parseTeam(r.rows[0]); }
async function updateTeam(id, fields) {
  const keys = Object.keys(fields); if (!keys.length) return;
  const values = keys.map(k => fields[k]); const set = keys.map((k,i) => `${k}=$${i+1}`).join(', ');
  await query(`UPDATE teams SET ${set} WHERE id=$${keys.length+1}`, [...values, id]);
}
async function createMatch(tournamentId, round, matchNumber, team1Id, team2Id, status='pending', winnerTeamId=null, bracketGroup='winners') {
  const r = await query('INSERT INTO matches (tournament_id,round,match_number,team1_id,team2_id,status,winner_team_id,bracket_group) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', [tournamentId, round, matchNumber, team1Id, team2Id, status, winnerTeamId, bracketGroup]);
  return getMatch(r.rows[0].id);
}
async function getMatches(tournamentId) { const r = await query('SELECT * FROM matches WHERE tournament_id=$1 ORDER BY round ASC, match_number ASC', [tournamentId]); return r.rows; }
async function getMatch(id) { const r = await query('SELECT * FROM matches WHERE id=$1', [id]); return r.rows[0] || null; }
async function updateMatch(id, fields) {
  const keys = Object.keys(fields); if (!keys.length) return;
  const values = keys.map(k => fields[k]); const set = keys.map((k,i) => `${k}=$${i+1}`).join(', ');
  await query(`UPDATE matches SET ${set}, updated_at=NOW() WHERE id=$${keys.length+1}`, [...values, id]);
}
async function getRoundMatches(tournamentId, round, bracketGroup = null) {
  if (bracketGroup) { const r = await query('SELECT * FROM matches WHERE tournament_id=$1 AND round=$2 AND bracket_group=$3 ORDER BY match_number ASC', [tournamentId, round, bracketGroup]); return r.rows; }
  const r = await query('SELECT * FROM matches WHERE tournament_id=$1 AND round=$2 ORDER BY match_number ASC', [tournamentId, round]); return r.rows;
}
async function getGroupRoundMatches(tournamentId, bracketGroup, round) { return getRoundMatches(tournamentId, round, bracketGroup); }
async function getLogs(tournamentId, limit = 50) { const r = await query('SELECT * FROM logs WHERE tournament_id=$1 ORDER BY id DESC LIMIT $2', [tournamentId, limit]); return r.rows; }
async function getOpenMatchesWithChannels(tournamentId) { const r = await query(`SELECT * FROM matches WHERE tournament_id=$1 AND status IN ('pending','reported')`, [tournamentId]); return r.rows; }

module.exports = {
  getSettings, upsertSettings, getActiveTournament, getActiveTournaments, getLatestTournament, getTournamentById,
  getTournamentForChannel, getTournamentForSignupChannel, getTournamentForCheckinChannel, getTournamentForBracketChannel,
  createTournament, updateTournament, resetTournament, addTeam, getTeams, getTeam, updateTeam, createMatch, getMatches,
  getMatch, updateMatch, getRoundMatches, getGroupRoundMatches, getOpenMatchesWithChannels, getLogs, log
};
