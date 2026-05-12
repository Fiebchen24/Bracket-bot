function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function createSingleElimBracket(teams, randomize = true) {
  const pool = randomize ? shuffle(teams) : [...teams];
  const size = nextPowerOfTwo(pool.length);
  while (pool.length < size) pool.push(null);

  const rounds = [];
  const round1 = [];
  for (let i = 0; i < pool.length; i += 2) {
    round1.push({ id: `R1M${round1.length + 1}`, round: 1, number: round1.length + 1, team1: pool[i], team2: pool[i + 1], winner: null, reportedWinner: null, status: 'pending' });
  }
  rounds.push(round1);

  let matchCount = round1.length / 2;
  let roundNo = 2;
  while (matchCount >= 1) {
    const round = [];
    for (let i = 0; i < matchCount; i++) {
      round.push({ id: `R${roundNo}M${i + 1}`, round: roundNo, number: i + 1, team1: null, team2: null, winner: null, reportedWinner: null, status: 'waiting' });
    }
    rounds.push(round);
    matchCount /= 2;
    roundNo++;
  }

  const tournament = { rounds };
  autoAdvanceByes(tournament);
  return tournament.rounds;
}

function getTeamName(team) { return team ? team.name : 'BYE'; }
function getTeamLine(team) { return team ? `${team.name} (${team.members.map(id => `<@${id}>`).join(' ')})` : 'BYE'; }

function findMatch(tournament, matchId) {
  for (const round of tournament.rounds || []) {
    const match = round.find(m => m.id === matchId);
    if (match) return match;
  }
  return null;
}

function autoAdvanceByes(tournament) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const round of tournament.rounds) {
      for (const match of round) {
        if (!match.winner && match.team1 && !match.team2) { advanceWinner(tournament, match.id, match.team1, true); changed = true; }
        if (!match.winner && !match.team1 && match.team2) { advanceWinner(tournament, match.id, match.team2, true); changed = true; }
      }
    }
  }
}

function advanceWinner(tournament, matchId, winnerTeam, auto = false) {
  const match = findMatch(tournament, matchId);
  if (!match) throw new Error('Match not found.');
  match.winner = winnerTeam;
  match.reportedWinner = null;
  match.status = auto ? 'auto-advanced' : 'completed';

  const nextRound = tournament.rounds[match.round];
  if (!nextRound) return;
  const targetIndex = Math.floor((match.number - 1) / 2);
  const target = nextRound[targetIndex];
  if (!target) return;
  if (match.number % 2 === 1) target.team1 = winnerTeam;
  else target.team2 = winnerTeam;
  if (target.team1 && target.team2 && target.status === 'waiting') target.status = 'pending';
}

function renderBracket(tournament) {
  if (!tournament) return 'No active tournament.';
  const lines = [`🏆 **${tournament.name}**`, `Status: **${tournament.status}**`, `Format: **${tournament.format || `${tournament.teamSize}v${tournament.teamSize}`}**`, ''];
  if (!tournament.rounds || tournament.rounds.length === 0) {
    lines.push(`Registered teams: **${tournament.teams.length}**`);
    for (const team of tournament.teams) lines.push(`• ${getTeamLine(team)} ${team.checkedIn ? '✅' : '⏳'}`);
    return lines.join('\n').slice(0, 3900);
  }
  for (const round of tournament.rounds) {
    lines.push(`__Round ${round[0]?.round || '?'}__`);
    for (const m of round) {
      lines.push(`**${m.id}**: ${getTeamName(m.team1)} vs ${getTeamName(m.team2)} → ${m.winner ? `Winner: **${m.winner.name}**` : m.reportedWinner ? `Reported: **${m.reportedWinner.name}**` : m.status}`);
    }
    lines.push('');
  }
  return lines.join('\n').slice(0, 3900);
}

module.exports = { createSingleElimBracket, findMatch, advanceWinner, renderBracket, getTeamName };
