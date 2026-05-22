const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const path = require('path');
const config = require('../config');
const repo = require('../db/repos');
const engine = require('../engine/bracketEngine');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../../views'));
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, '../../public')));
app.use(session({ secret: config.sessionSecret, resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

let discordAuthReady = false;
if (!config.clientId) console.warn('Dashboard OAuth missing CLIENT_ID / DISCORD_CLIENT_ID');
if (!config.clientSecret) console.warn('Dashboard OAuth missing CLIENT_SECRET / DISCORD_CLIENT_SECRET');
if (!config.baseUrl) console.warn('Dashboard OAuth missing BASE_URL');
if (config.clientId && config.clientSecret && config.baseUrl) {
  passport.use('discord', new DiscordStrategy({
    clientID: config.clientId,
    clientSecret: config.clientSecret,
    callbackURL: `${config.baseUrl}/auth/discord/callback`,
    scope: ['identify', 'guilds']
  }, (accessToken, refreshToken, profile, done) => done(null, profile)));
  discordAuthReady = true;
  console.log(`Discord OAuth ready. Callback: ${config.baseUrl}/auth/discord/callback`);
}
function requireAuth(req, res, next) { if (req.isAuthenticated?.()) return next(); res.redirect('/login'); }
function requireDiscordAuthConfigured(req, res, next) {
  if (discordAuthReady) return next();
  return res.status(500).send('Discord login is not configured. Please set CLIENT_ID, CLIENT_SECRET or DISCORD_CLIENT_SECRET, BASE_URL and SESSION_SECRET in Render.');
}
function userGuild(req, guildId) {
  return (req.user?.guilds || []).find(g => g.id === guildId) || null;
}
function userCanManageGuild(req, guildId) {
  const guild = userGuild(req, guildId);
  if (!guild) return false;
  const perms = BigInt(guild.permissions || 0);
  return Boolean((perms & BigInt(0x20)) || (perms & BigInt(0x8))); // MANAGE_GUILD or ADMINISTRATOR
}
async function getMemberRoles(guildId, userId) {
  if (!config.token) return [];
  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
      headers: { Authorization: `Bot ${config.token}` }
    });
    if (!response.ok) return [];
    const member = await response.json();
    return Array.isArray(member.roles) ? member.roles : [];
  } catch (err) {
    console.warn('Dashboard role lookup failed:', err.message);
    return [];
  }
}
async function getDashboardAccess(req, guildId, tournament = null, settings = null) {
  const inGuild = Boolean(userGuild(req, guildId));
  const canManageGuild = userCanManageGuild(req, guildId);
  let roles = [];
  if (inGuild) roles = await getMemberRoles(guildId, req.user.id);

  const staffRoleId = tournament?.staff_role_id || settings?.staff_role_id || null;
  const registrationRoleId = tournament?.registration_role_id || null;

  const hasStaffRole = Boolean(staffRoleId && roles.includes(staffRoleId));
  const hasRegistrationRole = Boolean(registrationRoleId && roles.includes(registrationRoleId));

  let isRegisteredPlayer = false;
  if (tournament) {
    const teams = await repo.getTeams(tournament.id);
    isRegisteredPlayer = teams.some(team => Array.isArray(team.players) && team.players.includes(req.user.id));
  }

  const canAdmin = inGuild && (canManageGuild || hasStaffRole);

  // Player view is controlled by the tournament registration role.
  // If an old tournament has no registration role configured, fall back to direct team membership.
  const canPlayerView = inGuild && (hasRegistrationRole || (!registrationRoleId && isRegisteredPlayer));
  const canView = Boolean(canAdmin || canPlayerView);

  return {
    inGuild,
    roles,
    staffRoleId,
    registrationRoleId,
    hasStaffRole,
    hasRegistrationRole,
    isPlayer: hasRegistrationRole || isRegisteredPlayer,
    isRegisteredPlayer,
    canManageGuild,
    canView,
    canAdmin,
    accessMode: canAdmin ? 'admin' : canPlayerView ? 'player' : 'denied'
  };
}

async function discordApi(path) {
  if (!config.token) return null;
  try {
    const response = await fetch(`https://discord.com/api/v10${path}`, { headers: { Authorization: `Bot ${config.token}` } });
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    console.warn('Discord API lookup failed:', err.message);
    return null;
  }
}
async function getGuildMeta(guildId, tournament = null) {
  const guild = await discordApi(`/guilds/${guildId}`);
  const ids = [tournament?.signup_channel_id, tournament?.bracket_channel_id, tournament?.checkin_channel_id, tournament?.match_category_id].filter(Boolean);
  const roleIds = [tournament?.staff_role_id, tournament?.registration_role_id].filter(Boolean);
  const channels = {};
  for (const id of ids) {
    const ch = await discordApi(`/channels/${id}`);
    if (ch) channels[id] = ch.name ? `#${ch.name}` : id;
  }
  const roles = {};
  if (roleIds.length) {
    const allRoles = await discordApi(`/guilds/${guildId}/roles`);
    if (Array.isArray(allRoles)) for (const r of allRoles) roles[r.id] = `@${r.name}`;
  }
  return { guildName: guild?.name || `Server ${guildId}`, channels, roles };
}

async function ensureGuildMember(req, res, next) {
  if (userGuild(req, req.params.guildId)) return next();
  return res.status(403).send('You must be a member of this Discord server to view this dashboard.');
}
async function ensureGuildDashboardAdmin(req, res, next) {
  try {
    const guildId = req.params.guildId;
    const tournamentId = Number(req.body.tournament_id || req.query.tournament_id || 0);
    let tournament = tournamentId ? await repo.getTournamentById(tournamentId) : null;
    if (!tournament && req.body.match_id) {
      const match = await repo.getMatch(Number(req.body.match_id));
      tournament = match ? await repo.getTournamentById(match.tournament_id) : null;
    }
    if (!tournament && req.body.team_id) {
      const team = await repo.getTeam(Number(req.body.team_id));
      tournament = team ? await repo.getTournamentById(team.tournament_id) : null;
    }
    if (!tournament) tournament = await repo.getLatestTournament(guildId);
    const settings = await repo.getSettings(guildId);
    const access = await getDashboardAccess(req, guildId, tournament, settings);
    if (access.canAdmin) return next();
    return res.status(403).send('Only the Discord server admin or the selected tournament host/staff role can manage this tournament.');
  } catch (err) { next(err); }
}

app.get('/', (req, res) => res.render('index', { user: req.user }));
app.get('/login', requireDiscordAuthConfigured, passport.authenticate('discord'));
app.get('/auth/discord/callback', requireDiscordAuthConfigured, passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/dashboard'));
app.get('/logout', (req, res, next) => req.logout(err => err ? next(err) : res.redirect('/')));

app.get('/dashboard', requireAuth, (req, res) => {
  // Show all mutual guilds. Access inside each guild is split between viewer and host/admin controls.
  const guilds = (req.user.guilds || []);
  res.render('dashboard', { user: req.user, guilds });
});

app.get('/guild/:guildId', requireAuth, ensureGuildMember, async (req, res, next) => {
  try {
    const guildId = req.params.guildId;
    const tournaments = await repo.getActiveTournaments(guildId);
    const latest = await repo.getLatestTournament(guildId);
    const selectedId = Number(req.query.tournament_id || tournaments[0]?.id || latest?.id || 0);
    const tournament = selectedId ? await repo.getTournamentById(selectedId) : null;
    const settings = await repo.getSettings(guildId);
    const validTournament = tournament && tournament.guild_id === guildId ? tournament : null;
    const bracketText = validTournament ? await engine.renderBracket(validTournament) : null;
    const data = validTournament ? await engine.getBracketView(validTournament) : { teams: [], matches: [] };
    const logs = validTournament ? await repo.getLogs(validTournament.id, 25) : [];
    const access = await getDashboardAccess(req, guildId, validTournament, settings);
    if (!access.canView) return res.status(403).send('Access denied. You need the selected tournament registration role to view this bracket, or the host/staff role to manage it.');
    const meta = await getGuildMeta(guildId, validTournament);
    res.render('guild', { guildId, meta, settings, tournaments, tournament: validTournament, bracketText, data, logs, access, user: req.user });
  } catch (err) { next(err); }
});

app.post('/guild/:guildId/reset', requireAuth, ensureGuildDashboardAdmin, async (req, res, next) => {
  try { const id = req.body.tournament_id ? Number(req.body.tournament_id) : null; await repo.resetTournament(req.params.guildId, id); res.redirect(`/guild/${req.params.guildId}`); } catch (err) { next(err); }
});
app.post('/guild/:guildId/start', requireAuth, ensureGuildDashboardAdmin, async (req, res, next) => {
  try { const t = await repo.getTournamentById(Number(req.body.tournament_id)); if (t && t.guild_id === req.params.guildId && t.status === 'registration') await engine.startBracket(t); res.redirect(`/guild/${req.params.guildId}?tournament_id=${t?.id || ''}`); } catch (err) { next(err); }
});
app.post('/guild/:guildId/approve', requireAuth, ensureGuildDashboardAdmin, async (req, res, next) => {
  try {
    const match = await repo.getMatch(Number(req.body.match_id));
    const t = match ? await repo.getTournamentById(match.tournament_id) : null;
    if (t && t.guild_id === req.params.guildId && match.reported_winner_id) {
      await repo.updateMatch(match.id, { winner_team_id: match.reported_winner_id, status: 'approved' });
      await engine.createNextRoundIfReady(await repo.getTournamentById(t.id));
    }
    res.redirect(`/guild/${req.params.guildId}?tournament_id=${t?.id || ''}`);
  } catch (err) { next(err); }
});
app.post('/guild/:guildId/force', requireAuth, ensureGuildDashboardAdmin, async (req, res, next) => {
  try {
    const match = await repo.getMatch(Number(req.body.match_id));
    const t = match ? await repo.getTournamentById(match.tournament_id) : null;
    const winnerId = Number(req.body.winner_team_id);
    if (t && t.guild_id === req.params.guildId && [match.team1_id, match.team2_id].includes(winnerId)) {
      await repo.updateMatch(match.id, { reported_winner_id: winnerId, winner_team_id: winnerId, status: 'approved' });
      await engine.createNextRoundIfReady(await repo.getTournamentById(t.id));
    }
    res.redirect(`/guild/${req.params.guildId}?tournament_id=${t?.id || ''}`);
  } catch (err) { next(err); }
});
app.post('/guild/:guildId/remove-team', requireAuth, ensureGuildDashboardAdmin, async (req, res, next) => {
  try {
    const teamId = Number(req.body.team_id);
    const team = await repo.getTeam(teamId);
    const tournament = team ? await repo.getTournamentById(team.tournament_id) : null;
    if (tournament && tournament.guild_id === req.params.guildId && tournament.status === 'registration') await repo.updateTeam(teamId, { active: 0 });
    res.redirect(`/guild/${req.params.guildId}?tournament_id=${tournament?.id || ''}`);
  } catch (err) { next(err); }
});
app.post('/guild/:guildId/edit-team', requireAuth, ensureGuildDashboardAdmin, async (req, res, next) => {
  try {
    const teamId = Number(req.body.team_id);
    const name = String(req.body.name || '').trim().slice(0, 80);
    const team = await repo.getTeam(teamId);
    const tournament = team ? await repo.getTournamentById(team.tournament_id) : null;
    if (tournament && tournament.guild_id === req.params.guildId && name) await repo.updateTeam(teamId, { name });
    res.redirect(`/guild/${req.params.guildId}?tournament_id=${tournament?.id || ''}`);
  } catch (err) { next(err); }
});

function startWeb() { app.listen(config.port, () => console.log(`Dashboard running on port ${config.port}`)); }
module.exports = { app, startWeb };
