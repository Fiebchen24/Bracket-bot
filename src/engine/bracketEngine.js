const repo = require('../db/repos');

function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }

function seedSingleElim(tournament) {
  const teams = shuffle(repo.getTeams(tournament.id));
  if (teams.length < 2) throw new Error(`Need at least 2 teams to start. Found ${teams.length}.`);

  let matchNo = 1;
  for (let i = 0; i < teams.length; i += 2) {
    const t1 = teams[i];
    const t2 = teams[i + 1];
    if (!t2) {
      repo.createMatch(tournament.id, 1, matchNo++, t1.id, null, 'bye', t1.id);
    } else {
      repo.createMatch(tournament.id, 1, matchNo++, t1.id, t2.id, 'pending');
    }
  }
  repo.updateTournament(tournament.id, { status: 'running', current_round: 1 });
  repo.log(tournament.guild_id, tournament.id, 'BRACKET_STARTED', `${teams.length} teams`);
  return repo.getMatches(tournament.id);
}

function allRoundDone(tournamentId, round) {
  return repo.getRoundMatches(tournamentId, round).every(m => m.status === 'approved' || m.status === 'bye');
}

function createNextRoundIfReady(tournament) {
  const round = tournament.current_round;
  if (!allRoundDone(tournament.id, round)) return false;
  const current = repo.getRoundMatches(tournament.id, round);
  const winners = current.map(m => m.winner_team_id).filter(Boolean);
  if (winners.length <= 1) {
    repo.updateTournament(tournament.id, { status: 'finished' });
    repo.log(tournament.guild_id, tournament.id, 'TOURNAMENT_FINISHED', `Winner team id: ${winners[0] || 'none'}`);
    return true;
  }
  const nextRound = round + 1;
  let matchNo = 1;
  for (let i = 0; i < winners.length; i += 2) {
    const t1 = winners[i];
    const t2 = winners[i + 1];
    if (!t2) repo.createMatch(tournament.id, nextRound, matchNo++, t1, null, 'bye', t1);
    else repo.createMatch(tournament.id, nextRound, matchNo++, t1, t2, 'pending');
  }
  repo.updateTournament(tournament.id, { current_round: nextRound });
  repo.log(tournament.guild_id, tournament.id, 'NEXT_ROUND_CREATED', `Round ${nextRound}`);
  return true;
}

function renderBracket(tournament) {
  const teams = repo.getTeams(tournament.id);
  const matches = repo.getMatches(tournament.id);
  const teamName = id => id ? (teams.find(t => t.id === id)?.name || `Team ${id}`) : 'BYE';
  const lines = [];
  lines.push(`**${tournament.name}** — ${tournament.team_size}v${tournament.team_size} — ${tournament.format}`);
  lines.push(`Status: **${tournament.status}** | Teams: **${teams.length}**`);
  if (!matches.length) {
    lines.push('\nRegistered teams:');
    teams.forEach((t, i) => lines.push(`${i+1}. ${t.name} — ${t.players.map(p => `<@${p}>`).join(' ')}`));
    return lines.join('\n');
  }
  let currentRound = null;
  for (const m of matches) {
    if (m.round !== currentRound) { currentRound = m.round; lines.push(`\n__Round ${currentRound}__`); }
    const status = m.status === 'approved' || m.status === 'bye' ? `✅ Winner: ${teamName(m.winner_team_id)}` : m.status === 'reported' ? `⏳ Reported: ${teamName(m.reported_winner_id)}` : '🕐 Pending';
    lines.push(`#${m.id} M${m.match_number}: ${teamName(m.team1_id)} vs ${teamName(m.team2_id)} — ${status}`);
  }
  return lines.join('\n').slice(0, 3900);
}

module.exports = { seedSingleElim, createNextRoundIfReady, renderBracket };
