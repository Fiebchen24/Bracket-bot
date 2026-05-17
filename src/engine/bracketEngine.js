const repo = require('../db/repos');
function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }
function teamName(id, teams) { return id ? (teams.find(t => t.id === id)?.name || `Team ${id}`) : 'BYE'; }
function isDone(m) { return m.status === 'approved' || m.status === 'bye'; }

async function createMatchesFromTeams(tournamentId, teamIds, round = 1, group = 'winners') {
  const created = [];
  let matchNo = 1;
  for (let i = 0; i < teamIds.length; i += 2) {
    const t1 = teamIds[i] || null;
    const t2 = teamIds[i + 1] || null;
    if (!t2) created.push(await repo.createMatch(tournamentId, round, matchNo++, t1, null, 'bye', t1, group));
    else created.push(await repo.createMatch(tournamentId, round, matchNo++, t1, t2, 'pending', null, group));
  }
  return created;
}
async function startSingle(tournament) {
  const teams = shuffle(await repo.getTeams(tournament.id));
  if (teams.length < 2) throw new Error('Need at least 2 teams to start.');
  await createMatchesFromTeams(tournament.id, teams.map(t => t.id), 1, 'winners');
  await repo.updateTournament(tournament.id, { status: 'running', current_round: 1 });
  await repo.log(tournament.guild_id, tournament.id, 'BRACKET_STARTED', `${teams.length} teams single`);
  await createNextRoundIfReady(await repo.getTournamentById(tournament.id));
  return repo.getMatches(tournament.id);
}
async function startDouble(tournament) {
  const teams = shuffle(await repo.getTeams(tournament.id));
  if (teams.length < 2) throw new Error('Need at least 2 teams to start.');
  await createMatchesFromTeams(tournament.id, teams.map(t => t.id), 1, 'winners');
  await repo.updateTournament(tournament.id, { status: 'running', current_round: 1 });
  await repo.log(tournament.guild_id, tournament.id, 'BRACKET_STARTED', `${teams.length} teams double`);
  await createNextRoundIfReady(await repo.getTournamentById(tournament.id));
  return repo.getMatches(tournament.id);
}
async function startBracket(tournament) {
  return tournament.format === 'double' ? startDouble(tournament) : startSingle(tournament);
}
async function winnersOfRound(tournamentId, group, round) {
  const ms = await repo.getGroupRoundMatches(tournamentId, group, round);
  if (!ms.length) return null;
  if (!ms.every(isDone)) return null;
  return ms.map(m => m.winner_team_id).filter(Boolean);
}
function losersOfMatches(ms) {
  return ms.map(m => (m.team1_id && m.team1_id !== m.winner_team_id ? m.team1_id : (m.team2_id && m.team2_id !== m.winner_team_id ? m.team2_id : null))).filter(Boolean);
}
async function roundExists(tournamentId, group, round) { return (await repo.getGroupRoundMatches(tournamentId, group, round)).length > 0; }

async function createNextRoundIfReady(tournament) {
  if (!tournament || tournament.status !== 'running') return;
  if (tournament.format === 'single') {
    const matches = await repo.getMatches(tournament.id);
    const rounds = [...new Set(matches.filter(m => m.bracket_group === 'winners').map(m => m.round))].sort((a,b)=>a-b);
    const round = rounds.at(-1) || 1;
    if (await roundExists(tournament.id, 'winners', round + 1)) return;
    const winners = await winnersOfRound(tournament.id, 'winners', round);
    if (!winners) return;
    if (winners.length <= 1) {
      await repo.updateTournament(tournament.id, { status: 'finished', winner_team_id: winners[0] || null });
      await repo.log(tournament.guild_id, tournament.id, 'TOURNAMENT_FINISHED', `Winner team id: ${winners[0] || 'none'}`);
      return;
    }
    await createMatchesFromTeams(tournament.id, winners, round + 1, 'winners');
    await repo.updateTournament(tournament.id, { current_round: round + 1 });
    await repo.log(tournament.guild_id, tournament.id, 'NEXT_ROUND_CREATED', `Round ${round + 1}`);
    await createNextRoundIfReady(await repo.getTournamentById(tournament.id));
    return;
  }

  // Simple double elimination engine: creates WB, LB, Grand Final. Stable for small/medium events.
  if (tournament.format === 'double') {
    const matches = await repo.getMatches(tournament.id);
    const groups = ['winners', 'losers'];
    for (const group of groups) {
      const groupMatches = matches.filter(m => m.bracket_group === group);
      const rounds = [...new Set(groupMatches.map(m => m.round))].sort((a,b)=>a-b);
      for (const round of rounds) {
        const roundMatches = await repo.getGroupRoundMatches(tournament.id, group, round);
        if (!roundMatches.length || !roundMatches.every(isDone)) continue;
        const winners = roundMatches.map(m => m.winner_team_id).filter(Boolean);
        if (group === 'winners') {
          if (winners.length > 1 && !(await roundExists(tournament.id, 'winners', round + 1))) {
            await createMatchesFromTeams(tournament.id, winners, round + 1, 'winners');
            await repo.log(tournament.guild_id, tournament.id, 'WB_NEXT_CREATED', `Winner bracket round ${round + 1}`);
          }
          const losers = losersOfMatches(roundMatches);
          if (losers.length && !(await roundExists(tournament.id, 'losers', round))) {
            await createMatchesFromTeams(tournament.id, losers, round, 'losers');
            await repo.log(tournament.guild_id, tournament.id, 'LB_CREATED', `Loser bracket round ${round}`);
          }
        } else if (group === 'losers') {
          if (winners.length > 1 && !(await roundExists(tournament.id, 'losers', round + 1))) {
            await createMatchesFromTeams(tournament.id, winners, round + 1, 'losers');
            await repo.log(tournament.guild_id, tournament.id, 'LB_NEXT_CREATED', `Loser bracket round ${round + 1}`);
          }
        }
      }
    }
    const fresh = await repo.getMatches(tournament.id);
    const wb = fresh.filter(m => m.bracket_group === 'winners');
    const lb = fresh.filter(m => m.bracket_group === 'losers');
    const wbDone = wb.length && wb.every(isDone);
    const lbDone = lb.length && lb.every(isDone);
    const grandExists = fresh.some(m => m.bracket_group === 'grand');
    if (wbDone && lbDone && !grandExists) {
      const wbWinner = wb.sort((a,b)=>b.round-a.round)[0]?.winner_team_id;
      const lbWinner = lb.sort((a,b)=>b.round-a.round)[0]?.winner_team_id;
      if (wbWinner && lbWinner && wbWinner !== lbWinner) {
        await repo.createMatch(tournament.id, 1, 1, wbWinner, lbWinner, 'pending', null, 'grand');
        await repo.log(tournament.guild_id, tournament.id, 'GRAND_FINAL_CREATED', 'Grand final created');
      } else if (wbWinner) {
        await repo.updateTournament(tournament.id, { status: 'finished', winner_team_id: wbWinner });
      }
    }
    const grand = (await repo.getMatches(tournament.id)).find(m => m.bracket_group === 'grand');
    if (grand && isDone(grand)) {
      await repo.updateTournament(tournament.id, { status: 'finished', winner_team_id: grand.winner_team_id });
      await repo.log(tournament.guild_id, tournament.id, 'TOURNAMENT_FINISHED', `Winner team id: ${grand.winner_team_id}`);
    }
  }
}

async function renderBracket(tournament) {
  const teams = await repo.getTeams(tournament.id);
  const matches = await repo.getMatches(tournament.id);
  if (!matches.length) return `**${tournament.name}** (#${tournament.id})\nStatus: ${tournament.status}\nNo matches yet.`;
  const grouped = {};
  for (const m of matches) {
    const g = m.bracket_group || 'winners';
    grouped[g] ||= {};
    grouped[g][m.round] ||= [];
    grouped[g][m.round].push(m);
  }
  let out = `**${tournament.name}** (#${tournament.id}) — ${tournament.format === 'double' ? 'Double Elimination' : 'Single Elimination'}\nStatus: **${tournament.status}**\n`;
  for (const group of ['winners','losers','grand']) {
    if (!grouped[group]) continue;
    out += `\n__${group === 'winners' ? 'Winner Bracket' : group === 'losers' ? 'Loser Bracket' : 'Grand Final'}__\n`;
    for (const round of Object.keys(grouped[group]).sort((a,b)=>Number(a)-Number(b))) {
      out += `Round ${round}:\n`;
      for (const m of grouped[group][round].sort((a,b)=>a.match_number-b.match_number)) {
        const winner = m.winner_team_id ? ` → Winner: **${teamName(m.winner_team_id, teams)}**` : '';
        out += `#${m.id}: ${teamName(m.team1_id, teams)} vs ${teamName(m.team2_id, teams)} [${m.status}]${winner}\n`;
      }
    }
  }
  return out.slice(0, 3900);
}
async function getBracketView(tournament) {
  const teams = await repo.getTeams(tournament.id);
  const byId = new Map(teams.map(t => [t.id, t]));
  const matches = (await repo.getMatches(tournament.id)).map(m => ({
    ...m,
    team1: m.team1_id ? byId.get(m.team1_id) || null : null,
    team2: m.team2_id ? byId.get(m.team2_id) || null : null,
    reportedWinner: m.reported_winner_id ? byId.get(m.reported_winner_id) || null : null,
    winner: m.winner_team_id ? byId.get(m.winner_team_id) || null : null,
    team1_name: teamName(m.team1_id, teams),
    team2_name: teamName(m.team2_id, teams),
    winner_name: teamName(m.winner_team_id, teams)
  }));
  return { tournament, teams, matches };
}
module.exports = { startBracket, createNextRoundIfReady, renderBracket, getBracketView };
