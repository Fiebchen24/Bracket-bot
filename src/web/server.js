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
function userCanManageGuild(req, guildId) {
  const guild = (req.user.guilds || []).find(g => g.id === guildId);
  if (!guild) return false;
  const perms = BigInt(guild.permissions || 0);
  return Boolean((perms & BigInt(0x20)) || (perms & BigInt(0x8)));
}
function ensureGuildAdmin(req, res, next) { if (userCanManageGuild(req, req.params.guildId)) return next(); return res.status(403).send('Not allowed for this server.'); }

app.get('/', (req, res) => res.render('index', { user: req.user }));
app.get('/login', requireDiscordAuthConfigured, passport.authenticate('discord'));
app.get('/auth/discord/callback', requireDiscordAuthConfigured, passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/dashboard'));
app.get('/logout', (req, res, next) => req.logout(err => err ? next(err) : res.redirect('/')));

app.get('/dashboard', requireAuth, (req, res) => {
  const guilds = (req.user.guilds || []).filter(g => (BigInt(g.permissions || 0) & BigInt(0x20)) || (BigInt(g.permissions || 0) & BigInt(0x8)));
  res.render('dashboard', { user: req.user, guilds });
});

app.get('/guild/:guildId', requireAuth, ensureGuildAdmin, (req, res) => {
  const guildId = req.params.guildId;
  const tournaments = repo.getActiveTournaments(guildId);
  const latest = repo.getLatestTournament(guildId);
  const selectedId = Number(req.query.tournament_id || tournaments[0]?.id || latest?.id || 0);
  const tournament = selectedId ? repo.getTournamentById(selectedId) : null;
  const settings = repo.getSettings(guildId);
  const validTournament = tournament && tournament.guild_id === guildId ? tournament : null;
  const bracketText = validTournament ? engine.renderBracket(validTournament) : null;
  const data = validTournament ? engine.bracketData(validTournament) : { teams: [], matches: [] };
  const logs = validTournament ? repo.getLogs(validTournament.id, 25) : [];
  res.render('guild', { guildId, settings, tournaments, tournament: validTournament, bracketText, data, logs });
});

app.post('/guild/:guildId/reset', requireAuth, ensureGuildAdmin, (req, res) => {
  const id = req.body.tournament_id ? Number(req.body.tournament_id) : null;
  repo.resetTournament(req.params.guildId, id);
  res.redirect(`/guild/${req.params.guildId}`);
});
app.post('/guild/:guildId/start', requireAuth, ensureGuildAdmin, (req, res) => {
  const t = repo.getTournamentById(Number(req.body.tournament_id));
  if (t && t.guild_id === req.params.guildId && t.status === 'registration') engine.startBracket(t);
  res.redirect(`/guild/${req.params.guildId}?tournament_id=${t?.id || ''}`);
});
app.post('/guild/:guildId/approve', requireAuth, ensureGuildAdmin, (req, res) => {
  const match = repo.getMatch(Number(req.body.match_id));
  const t = match ? repo.getTournamentById(match.tournament_id) : null;
  if (t && t.guild_id === req.params.guildId && match.reported_winner_id) {
    repo.updateMatch(match.id, { winner_team_id: match.reported_winner_id, status: 'approved' });
    engine.createNextRoundIfReady(repo.getTournamentById(t.id));
  }
  res.redirect(`/guild/${req.params.guildId}?tournament_id=${t?.id || ''}`);
});
app.post('/guild/:guildId/force', requireAuth, ensureGuildAdmin, (req, res) => {
  const match = repo.getMatch(Number(req.body.match_id));
  const t = match ? repo.getTournamentById(match.tournament_id) : null;
  const winnerId = Number(req.body.winner_team_id);
  if (t && t.guild_id === req.params.guildId && [match.team1_id, match.team2_id].includes(winnerId)) {
    repo.updateMatch(match.id, { reported_winner_id: winnerId, winner_team_id: winnerId, status: 'approved' });
    engine.createNextRoundIfReady(repo.getTournamentById(t.id));
  }
  res.redirect(`/guild/${req.params.guildId}?tournament_id=${t?.id || ''}`);
});
app.post('/guild/:guildId/remove-team', requireAuth, ensureGuildAdmin, (req, res) => {
  const teamId = Number(req.body.team_id);
  const team = repo.getTeam(teamId);
  const tournament = team ? repo.getTournamentById(team.tournament_id) : null;
  if (tournament && tournament.guild_id === req.params.guildId && tournament.status === 'registration') repo.updateTeam(teamId, { active: 0 });
  res.redirect(`/guild/${req.params.guildId}?tournament_id=${tournament?.id || ''}`);
});
app.post('/guild/:guildId/edit-team', requireAuth, ensureGuildAdmin, (req, res) => {
  const teamId = Number(req.body.team_id);
  const name = String(req.body.name || '').trim().slice(0, 80);
  const team = repo.getTeam(teamId);
  const tournament = team ? repo.getTournamentById(team.tournament_id) : null;
  if (tournament && tournament.guild_id === req.params.guildId && name) repo.updateTeam(teamId, { name });
  res.redirect(`/guild/${req.params.guildId}?tournament_id=${tournament?.id || ''}`);
});

function startWeb() { app.listen(config.port, () => console.log(`Dashboard running on port ${config.port}`)); }
module.exports = { app, startWeb };
