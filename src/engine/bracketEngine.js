const repo = require('../db/repos');

function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }
function pairIds(tournamentId, teamIds, round, group) {
  const created = [];
  let matchNo = 1;
  for (let i = 0; i < teamIds.length; i += 2) {
    const t1 = teamIds[i];
    const t2 = teamIds[i + 1] || null;
    if (!t2) created.push(repo.createMatch(tournamentId, round, matchNo++, t1, null, 'bye', t1, group));
    else created.push(repo.createMatch(tournamentId, round, matchNo++, t1, t2, 'pending', null, group));
  }
  return created;
}
function seedSingleElim(tournament) {
  const teams = shuffle(repo.getTeams(tournament.id));
  if (teams.length < 2) throw new Error(`Need at least 2 teams to start. Found ${teams.length}.`);
  pairIds(tournament.id, teams.map(t => t.id), 1, 'winners');
  repo.updateTournament(tournament.id, { status: 'running', current_round: 1 });
  repo.log(tournament.guild_id, tournament.id, 'BRACKET_STARTED', `${teams.length} teams single`);
  createNextRoundIfReady(repo.getTournamentById(tournament.id));
  return repo.getMatches(tournament.id);
}
function seedDoubleElim(tournament) {
  const teams = shuffle(repo.getTeams(tournament.id));
  if (teams.length < 2) throw new Error(`Need at least 2 teams to start. Found ${teams.length}.`);
  pairIds(tournament.id, teams.map(t => t.id), 1, 'winners');
  repo.updateTournament(tournament.id, { status: 'running', current_round: 1 });
  repo.log(tournament.guild_id, tournament.id, 'BRACKET_STARTED', `${teams.length} teams double`);
  createNextRoundIfReady(repo.getTournamentById(tournament.id));
  return repo.getMatches(tournament.id);
}
function startBracket(tournament) {
  return tournament.format === 'double' ? seedDoubleElim(tournament) : seedSingleElim(tournament);
}
function isDone(m) { return ['approved','bye'].includes(m.status); }
function groupRoundDone(tournamentId, group, round) {
  const ms = repo.getGroupRoundMatches(tournamentId, group, round);
  return ms.length > 0 && ms.every(isDone);
}
function matchLoser(m) {
  if (!m.winner_team_id || !m.team1_id || !m.team2_id) return null;
  return m.winner_team_id === m.team1_id ? m.team2_id : m.team1_id;
}
function roundExists(tournamentId, group, round) { return repo.getGroupRoundMatches(tournamentId, group, round).length > 0; }
function createNextRoundIfReady(tournament) {
  if (!tournament) return false;
  return tournament.format === 'double' ? createNextDoubleRounds(tournament) : createNextSingleRound(tournament);
}
function createNextSingleRound(tournament) {
  let changed = false;
  while (true) {
    const rounds = [...new Set(repo.getMatches(tournament.id).filter(m => m.bracket_group === 'winners').map(m => m.round))].sort((a,b)=>a-b);
    let progressed = false;
    for (const round of rounds) {
      if (!groupRoundDone(tournament.id, 'winners', round)) continue;
      if (roundExists(tournament.id, 'winners', round + 1)) continue;
      const winners = repo.getGroupRoundMatches(tournament.id, 'winners', round).map(m => m.winner_team_id).filter(Boolean);
      if (winners.length <= 1) {
        repo.updateTournament(tournament.id, { status: 'finished', winner_team_id: winners[0] || null });
        repo.log(tournament.guild_id, tournament.id, 'TOURNAMENT_FINISHED', `Winner team id: ${winners[0] || 'none'}`);
        return true;
      }
      pairIds(tournament.id, winners, round + 1, 'winners');
      repo.updateTournament(tournament.id, { current_round: round + 1 });
      repo.log(tournament.guild_id, tournament.id, 'NEXT_ROUND_CREATED', `Round ${round + 1}`);
      changed = progressed = true;
      break;
    }
    if (!progressed) break;
  }
  return changed;
}
function createNextDoubleRounds(tournament) {
  let changed = false;
  for (let guard = 0; guard < 10; guard++) {
    let progressed = false;
    const matches = repo.getMatches(tournament.id);
    const groups = ['winners','losers'];
    for (const group of groups) {
      const rounds = [...new Set(matches.filter(m => m.bracket_group === group).map(m => m.round))].sort((a,b)=>a-b);
      for (const round of rounds) {
        if (!groupRoundDone(tournament.id, group, round)) continue;
        const roundMatches = repo.getGroupRoundMatches(tournament.id, group, round);
        const winners = roundMatches.map(m => m.winner_team_id).filter(Boolean);
        if (group === 'winners') {
          const losers = roundMatches.map(matchLoser).filter(Boolean);
          if (winners.length > 1 && !roundExists(tournament.id, 'winners', round + 1)) {
            pairIds(tournament.id, winners, round + 1, 'winners');
            repo.log(tournament.guild_id, tournament.id, 'WB_NEXT_CREATED', `Winner bracket round ${round + 1}`);
            changed = progressed = true;
          }
          if (losers.length) {
            const lbRound = Math.max(1, round * 2 - 1);
            if (!roundExists(tournament.id, 'losers', lbRound)) {
              pairIds(tournament.id, losers, lbRound, 'losers');
              repo.log(tournament.guild_id, tournament.id, 'LB_CREATED', `Loser bracket round ${lbRound}`);
              changed = progressed = true;
            }
          }
        } else {
          if (winners.length > 1 && !roundExists(tournament.id, 'losers', round + 1)) {
            pairIds(tournament.id, winners, round + 1, 'losers');
            repo.log(tournament.guild_id, tournament.id, 'LB_NEXT_CREATED', `Loser bracket round ${round + 1}`);
            changed = progressed = true;
          }
        }
      }
    }
    const fresh = repo.getMatches(tournament.id);
    const pendingWB = fresh.some(m => m.bracket_group === 'winners' && !isDone(m));
    const pendingLB = fresh.some(m => m.bracket_group === 'losers' && !isDone(m));
    const wbDoneMatches = fresh.filter(m => m.bracket_group === 'winners' && isDone(m));
    const lbDoneMatches = fresh.filter(m => m.bracket_group === 'losers' && isDone(m));
    const maxWbRound = Math.max(0, ...fresh.filter(m => m.bracket_group === 'winners').map(m => m.round));
    const maxLbRound = Math.max(0, ...fresh.filter(m => m.bracket_group === 'losers').map(m => m.round));
    const wbFinal = wbDoneMatches.find(m => m.round === maxWbRound && m.winner_team_id);
    const lbFinal = lbDoneMatches.find(m => m.round === maxLbRound && m.winner_team_id);
    if (!pendingWB && !pendingLB && wbFinal && lbFinal && !fresh.some(m => m.bracket_group === 'grand')) {
      if (wbFinal.winner_team_id === lbFinal.winner_team_id) {
        repo.updateTournament(tournament.id, { status: 'finished', winner_team_id: wbFinal.winner_team_id });
        repo.log(tournament.guild_id, tournament.id, 'TOURNAMENT_FINISHED', `Winner team id: ${wbFinal.winner_team_id}`);
      } else {
        repo.createMatch(tournament.id, 1, 1, wbFinal.winner_team_id, lbFinal.winner_team_id, 'pending', null, 'grand');
        repo.log(tournament.guild_id, tournament.id, 'GRAND_FINAL_CREATED', 'Grand final created');
        changed = progressed = true;
      }
    }
    const grand = fresh.filter(m => m.bracket_group === 'grand');
    if (grand.length && grand.every(isDone)) {
      const winner = grand[grand.length - 1].winner_team_id;
      repo.updateTournament(tournament.id, { status: 'finished', winner_team_id: winner });
      repo.log(tournament.guild_id, tournament.id, 'TOURNAMENT_FINISHED', `Winner team id: ${winner}`);
      return true;
    }
    if (!progressed) break;
  }
  return changed;
}
function renderBracket(tournament) {
  const teams = repo.getTeams(tournament.id);
  const matches = repo.getMatches(tournament.id);
  const teamName = id => id ? (teams.find(t => t.id === id)?.name || `Team ${id}`) : 'BYE';
  const lines = [];
  const winner = tournament.winner_team_id ? ` | Winner: **${teamName(tournament.winner_team_id)}**` : '';
  lines.push(`**${tournament.name}** — ${tournament.team_size}v${tournament.team_size} — ${tournament.format}${winner}`);
  lines.push(`Status: **${tournament.status}** | Teams: **${teams.length}** | Check-in: **${tournament.require_checkin ? 'required' : 'off'}**`);
  if (!matches.length) {
    lines.push('\nRegistered teams:');
    teams.forEach((t, i) => lines.push(`${i+1}. ${t.name} ${t.checked_in ? '✅' : tournament.require_checkin ? '⏳' : '➖'} — ${t.players.map(p => `<@${p}>`).join(' ')}`));
    return lines.join('\n');
  }
  const groupTitle = { winners: 'Winner Bracket', losers: 'Loser Bracket', grand: 'Grand Final' };
  for (const group of ['winners','losers','grand']) {
    const groupMatches = matches.filter(m => (m.bracket_group || 'winners') === group);
    if (!groupMatches.length) continue;
    lines.push(`\n__${groupTitle[group]}__`);
    let currentRound = null;
    for (const m of groupMatches) {
      if (m.round !== currentRound) { currentRound = m.round; lines.push(`**Round ${currentRound}**`); }
      const status = m.status === 'approved' || m.status === 'bye' ? `✅ Winner: ${teamName(m.winner_team_id)}` : m.status === 'reported' ? `⏳ Reported: ${teamName(m.reported_winner_id)}` : '🕐 Pending';
      lines.push(`#${m.id} M${m.match_number}: ${teamName(m.team1_id)} vs ${teamName(m.team2_id)} — ${status}`);
    }
  }
  return lines.join('\n').slice(0, 3900);
}
function bracketData(tournament) {
  const teams = repo.getTeams(tournament.id);
  const teamById = new Map(teams.map(t => [t.id, t]));
  const matches = repo.getMatches(tournament.id).map(m => ({
    ...m,
    team1: m.team1_id ? teamById.get(m.team1_id) : null,
    team2: m.team2_id ? teamById.get(m.team2_id) : null,
    winner: m.winner_team_id ? teamById.get(m.winner_team_id) : null,
    reportedWinner: m.reported_winner_id ? teamById.get(m.reported_winner_id) : null
  }));
  return { teams, matches };
}
module.exports = { seedSingleElim, seedDoubleElim, startBracket, createNextRoundIfReady, renderBracket, bracketData };
