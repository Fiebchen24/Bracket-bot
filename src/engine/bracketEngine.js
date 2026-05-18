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

  let changed = true;
  let guard = 0;
  while (changed && guard++ < 25) {
    changed = false;

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
      changed = true;
      continue;
    }

    // Double elimination engine.
    // LB mapping used here:
    //   WB R1 losers -> LB R1
    //   LB R1 winners + WB R2 losers -> LB R2
    //   LB R2 winners -> LB R3
    //   LB R3 winners + WB R3 losers -> LB R4
    //   ... final WB loser joins final LB round before Grand Final.
    const allMatches = await repo.getMatches(tournament.id);
    const wbRounds = [...new Set(allMatches.filter(m => m.bracket_group === 'winners').map(m => m.round))].sort((a,b)=>a-b);
    const lastWbRound = wbRounds.at(-1) || 1;

    // Create next Winner Bracket round when current WB round is complete.
    const lastWbMatches = await repo.getGroupRoundMatches(tournament.id, 'winners', lastWbRound);
    if (lastWbMatches.length && lastWbMatches.every(isDone) && !(await roundExists(tournament.id, 'winners', lastWbRound + 1))) {
      const wbWinners = lastWbMatches.map(m => m.winner_team_id).filter(Boolean);
      if (wbWinners.length > 1) {
        await createMatchesFromTeams(tournament.id, wbWinners, lastWbRound + 1, 'winners');
        await repo.log(tournament.guild_id, tournament.id, 'WB_NEXT_CREATED', `Winner bracket round ${lastWbRound + 1}`);
        changed = true;
        continue;
      }
    }

    // Create the next missing Loser Bracket round if prerequisites are complete.
    const current = await repo.getMatches(tournament.id);
    const currentWbRounds = [...new Set(current.filter(m => m.bracket_group === 'winners').map(m => m.round))].sort((a,b)=>a-b);
    const possibleMaxLbRound = Math.max(1, (currentWbRounds.at(-1) || 1) * 2 - 2);
    const existingLbRounds = new Set(current.filter(m => m.bracket_group === 'losers').map(m => m.round));

    for (let lbRound = 1; lbRound <= possibleMaxLbRound; lbRound++) {
      if (existingLbRounds.has(lbRound)) continue;
      let entrants = [];
      if (lbRound === 1) {
        const wb1 = await repo.getGroupRoundMatches(tournament.id, 'winners', 1);
        if (!wb1.length || !wb1.every(isDone)) break;
        entrants = losersOfMatches(wb1);
      } else if (lbRound % 2 === 0) {
        const prev = await winnersOfRound(tournament.id, 'losers', lbRound - 1);
        if (!prev) break;
        const wbRound = lbRound / 2 + 1;
        const wb = await repo.getGroupRoundMatches(tournament.id, 'winners', wbRound);
        if (!wb.length || !wb.every(isDone)) break;
        const drops = losersOfMatches(wb);
        entrants = [];
        const max = Math.max(prev.length, drops.length);
        for (let i = 0; i < max; i++) {
          if (prev[i]) entrants.push(prev[i]);
          if (drops[i]) entrants.push(drops[i]);
        }
      } else {
        const prev = await winnersOfRound(tournament.id, 'losers', lbRound - 1);
        if (!prev) break;
        entrants = prev;
      }

      if (entrants.length >= 1) {
        if (entrants.length === 1) {
          await repo.createMatch(tournament.id, lbRound, 1, entrants[0], null, 'bye', entrants[0], 'losers');
        } else {
          await createMatchesFromTeams(tournament.id, entrants, lbRound, 'losers');
        }
        await repo.log(tournament.guild_id, tournament.id, 'LB_ROUND_CREATED', `Loser bracket round ${lbRound}`);
        changed = true;
      }
      break;
    }

    // Create Grand Final only after WB champion and final LB champion exist.
    const latest = await repo.getMatches(tournament.id);
    const grandExists = latest.some(m => m.bracket_group === 'grand');
    if (!grandExists) {
      const wbLatestRound = Math.max(...latest.filter(m => m.bracket_group === 'winners').map(m => m.round));
      const wbFinal = await repo.getGroupRoundMatches(tournament.id, 'winners', wbLatestRound);
      const wbChampion = wbFinal.length && wbFinal.every(isDone) ? wbFinal.map(m => m.winner_team_id).filter(Boolean)[0] : null;
      const expectedLastLbRound = Math.max(1, wbLatestRound * 2 - 2);
      const lbFinal = await repo.getGroupRoundMatches(tournament.id, 'losers', expectedLastLbRound);
      const lbChampion = lbFinal.length && lbFinal.every(isDone) ? lbFinal.map(m => m.winner_team_id).filter(Boolean)[0] : null;
      if (wbChampion && lbChampion && wbChampion !== lbChampion) {
        await repo.createMatch(tournament.id, 1, 1, wbChampion, lbChampion, 'pending', null, 'grand');
        await repo.log(tournament.guild_id, tournament.id, 'GRAND_FINAL_CREATED', 'Grand final created');
        changed = true;
      }
    }

    const grandMatches = (await repo.getMatches(tournament.id)).filter(m => m.bracket_group === 'grand').sort((a,b)=>a.round-b.round);
    const grand = grandMatches.at(-1);
    if (grand && isDone(grand)) {
      // Basic reset final: if LB side wins first grand final, create a reset match.
      const firstGrand = grandMatches[0];
      if (grandMatches.length === 1 && grand.winner_team_id === firstGrand.team2_id) {
        await repo.createMatch(tournament.id, 2, 1, firstGrand.team1_id, firstGrand.team2_id, 'pending', null, 'grand');
        await repo.log(tournament.guild_id, tournament.id, 'GRAND_FINAL_RESET_CREATED', 'Reset final created');
        changed = true;
      } else {
        await repo.updateTournament(tournament.id, { status: 'finished', winner_team_id: grand.winner_team_id });
        await repo.log(tournament.guild_id, tournament.id, 'TOURNAMENT_FINISHED', `Winner team id: ${grand.winner_team_id}`);
      }
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
