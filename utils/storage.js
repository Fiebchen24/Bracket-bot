const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const guildsFile = path.join(dataDir, 'guilds.json');
const tournamentsFile = path.join(dataDir, 'tournaments.json');

function ensureFiles() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(guildsFile)) fs.writeFileSync(guildsFile, '{}');
  if (!fs.existsSync(tournamentsFile)) fs.writeFileSync(tournamentsFile, '{}');
}

function readJson(file) {
  ensureFiles();
  try { return JSON.parse(fs.readFileSync(file, 'utf8') || '{}'); }
  catch { return {}; }
}

function writeJson(file, data) {
  ensureFiles();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getGuildConfig(guildId) {
  return readJson(guildsFile)[guildId] || null;
}

function setGuildConfig(guildId, config) {
  const guilds = readJson(guildsFile);
  guilds[guildId] = { ...(guilds[guildId] || {}), ...config, updatedAt: new Date().toISOString() };
  writeJson(guildsFile, guilds);
  return guilds[guildId];
}

function getTournament(guildId) {
  return readJson(tournamentsFile)[guildId] || null;
}

function setTournament(guildId, tournament) {
  const tournaments = readJson(tournamentsFile);
  tournaments[guildId] = tournament;
  writeJson(tournamentsFile, tournaments);
  return tournament;
}

function deleteTournament(guildId) {
  const tournaments = readJson(tournamentsFile);
  delete tournaments[guildId];
  writeJson(tournamentsFile, tournaments);
}

module.exports = { getGuildConfig, setGuildConfig, getTournament, setTournament, deleteTournament };
