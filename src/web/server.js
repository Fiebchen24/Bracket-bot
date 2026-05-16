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

if (config.clientSecret) {
  passport.use(new DiscordStrategy({
    clientID: config.clientId,
    clientSecret: config.clientSecret,
    callbackURL: `${config.baseUrl}/auth/discord/callback`,
    scope: ['identify', 'guilds']
  }, (accessToken, refreshToken, profile, done) => done(null, profile)));
}

function requireAuth(req, res, next) { if (req.isAuthenticated?.()) return next(); res.redirect('/login'); }

app.get('/', (req, res) => res.render('index', { user: req.user }));
app.get('/login', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/dashboard'));
app.get('/logout', (req, res, next) => req.logout(err => err ? next(err) : res.redirect('/')));

app.get('/dashboard', requireAuth, (req, res) => {
  const guilds = (req.user.guilds || []).filter(g => (BigInt(g.permissions || 0) & BigInt(0x20)) || (BigInt(g.permissions || 0) & BigInt(0x8)));
  res.render('dashboard', { user: req.user, guilds });
});

app.get('/guild/:guildId', requireAuth, (req, res) => {
  const guildId = req.params.guildId;
  const tournaments = repo.getActiveTournaments(guildId);
  const latest = repo.getLatestTournament(guildId);
  const selectedId = Number(req.query.tournament_id || tournaments[0]?.id || latest?.id || 0);
  const tournament = selectedId ? repo.getTournamentById(selectedId) : null;
  const settings = repo.getSettings(guildId);
  const bracketText = tournament && tournament.guild_id === guildId ? engine.renderBracket(tournament) : null;
  res.render('guild', { guildId, settings, tournaments, tournament, bracketText });
});

app.post('/guild/:guildId/reset', requireAuth, (req, res) => {
  const id = req.body.tournament_id ? Number(req.body.tournament_id) : null;
  repo.resetTournament(req.params.guildId, id);
  res.redirect(`/guild/${req.params.guildId}`);
});

app.post('/guild/:guildId/start', requireAuth, (req, res) => {
  const t = repo.getTournamentById(Number(req.body.tournament_id));
  if (t && t.guild_id === req.params.guildId && t.status === 'registration') engine.seedSingleElim({...t, format: 'single'});
  res.redirect(`/guild/${req.params.guildId}?tournament_id=${t?.id || ''}`);
});

app.post('/guild/:guildId/approve', requireAuth, (req, res) => {
  const match = repo.getMatch(Number(req.body.match_id));
  const t = match ? repo.getTournamentById(match.tournament_id) : null;
  if (t && t.guild_id === req.params.guildId && match.reported_winner_id) {
    repo.updateMatch(match.id, { winner_team_id: match.reported_winner_id, status: 'approved' });
    engine.createNextRoundIfReady(t);
  }
  res.redirect(`/guild/${req.params.guildId}?tournament_id=${t?.id || ''}`);
});

function startWeb() { app.listen(config.port, () => console.log(`Dashboard running on port ${config.port}`)); }
module.exports = { app, startWeb };
