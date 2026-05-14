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
  const tournament = repo.getActiveTournament(guildId);
  const settings = repo.getSettings(guildId);
  res.render('guild', { guildId, settings, tournament, bracketText: tournament ? engine.renderBracket(tournament) : null });
});

app.post('/guild/:guildId/create', requireAuth, (req, res) => {
  const { name, team_size, format } = req.body;
  const active = repo.getActiveTournament(req.params.guildId);
  if (!active) repo.createTournament(req.params.guildId, name, Number(team_size), format, req.user.id);
  res.redirect(`/guild/${req.params.guildId}`);
});

app.post('/guild/:guildId/reset', requireAuth, (req, res) => { repo.resetTournament(req.params.guildId); res.redirect(`/guild/${req.params.guildId}`); });

app.post('/guild/:guildId/start', requireAuth, (req, res) => {
  const t = repo.getActiveTournament(req.params.guildId);
  if (t && t.status === 'registration') engine.seedSingleElim({...t, format: 'single'});
  res.redirect(`/guild/${req.params.guildId}`);
});

app.post('/guild/:guildId/approve', requireAuth, (req, res) => {
  const t = repo.getActiveTournament(req.params.guildId);
  const match = repo.getMatch(Number(req.body.match_id));
  if (t && match && match.tournament_id === t.id && match.reported_winner_id) {
    repo.updateMatch(match.id, { winner_team_id: match.reported_winner_id, status: 'approved' });
    engine.createNextRoundIfReady(t);
  }
  res.redirect(`/guild/${req.params.guildId}`);
});

function startWeb() {
  app.listen(config.port, () => console.log(`Dashboard running on port ${config.port}`));
}
module.exports = { app, startWeb };
