const repo = require('../db/repos');

function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }
function teamName(id, teams) { return id ? (teams.find(t => t.id === id)?.name || `Team ${id}`) : 'BYE'; }
function isDone(m) { return m.status === 'approved' || m.status === 'bye'; }
function unique(arr) { return [...new Set(arr.filter(Boolean))]; }

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
  if (tournament.format === 'double') return startDouble(tournament);
  if (tournament.format === 'round_robin') return startRoundRobin(tournament);
  return startSingle(tournament);
}

async function startRoundRobin(tournament) {
  const teams = await repo.getTeams(tournament.id);
  const teamIds = teams.filter(t => t.active).map(t => t.id);
  const existing = await repo.getMatches(tournament.id);
  if (existing.length) return existing;
  let matchNo = 1;
  const created = [];
  // Circle-method style rounds: every team plays every other team once.
  const arr = [...teamIds];
  if (arr.length % 2 === 1) arr.push(null);
  const n = arr.length;
  const rounds = n - 1;
  for (let r = 1; r <= rounds; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a && b) created.push(await repo.createMatch(tournament.id, r, matchNo++, a, b, 'pending', null, 'round_robin'));
    }
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr.splice(0, arr.length, fixed, ...rest);
  }
  await repo.updateTournament(tournament.id, { status: 'running' });
  return created;
}

async function winnersOfRound(tournamentId, group, round) {
  const ms = await repo.getGroupRoundMatches(tournamentId, group, round);
  if (!ms.length) return null;
  if (!ms.every(isDone)) return null;
  return unique(ms.map(m => m.winner_team_id));
}

function losersOfMatches(ms) {
  return unique(ms.map(m => {
    if (!isDone(m)) return null;
    if (m.team1_id && m.team1_id !== m.winner_team_id) return m.team1_id;
    if (m.team2_id && m.team2_id !== m.winner_team_id) return m.team2_id;
    return null;
  }));
}

async function roundExists(tournamentId, group, round) {
  return (await repo.getGroupRoundMatches(tournamentId, group, round)).length > 0;
}

async function latestExistingLbRound(tournamentId, beforeRound) {
  const matches = await repo.getMatches(tournamentId);
  const rounds = [...new Set(matches.filter(m => m.bracket_group === 'losers' && m.round < beforeRound).map(m => m.round))].sort((a,b)=>a-b);
  return rounds.at(-1) || null;
}

async function loserFrontierBefore(tournamentId, nextLbRound) {
  const latest = await latestExistingLbRound(tournamentId, nextLbRound);
  if (latest) return winnersOfRound(tournamentId, 'losers', latest);
  const wb1 = await repo.getGroupRoundMatches(tournamentId, 'winners', 1);
  if (!wb1.length || !wb1.every(isDone)) return null;
  return losersOfMatches(wb1);
}

function interleave(a, b) {
  const out = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return unique(out);
}

async function buildLoserRoundEntrants(tournamentId, lbRound) {
  if (lbRound === 1) {
    const wb1 = await repo.getGroupRoundMatches(tournamentId, 'winners', 1);
    if (!wb1.length || !wb1.every(isDone)) return { blocked: true, entrants: [] };
    return { blocked: false, entrants: losersOfMatches(wb1), carryOnly: losersOfMatches(wb1).length === 1 };
  }

  const prev = await loserFrontierBefore(tournamentId, lbRound);
  if (prev === null) return { blocked: true, entrants: [] };

  // Even loser rounds receive fresh drops from the corresponding winner-bracket round.
  if (lbRound % 2 === 0) {
    const wbRound = (lbRound / 2) + 1;
    const wb = await repo.getGroupRoundMatches(tournamentId, 'winners', wbRound);
    if (!wb.length || !wb.every(isDone)) return { blocked: true, entrants: [] };
    const drops = losersOfMatches(wb);
    return { blocked: false, entrants: interleave(prev, drops), carryOnly: interleave(prev, drops).length === 1 };
  }

  // Odd loser rounds are consolidation rounds. Do not create a pointless BYE match for one team;
  // carry that team forward until the next winner-bracket drop is available.
  return { blocked: false, entrants: prev, carryOnly: prev.length === 1 };
}

async function maybeCreateNextWinnerRound(tournament) {
  const all = await repo.getMatches(tournament.id);
  const wbRounds = [...new Set(all.filter(m => m.bracket_group === 'winners').map(m => m.round))].sort((a,b)=>a-b);
  const last = wbRounds.at(-1) || 1;
  const ms = await repo.getGroupRoundMatches(tournament.id, 'winners', last);
  if (!ms.length || !ms.every(isDone)) return false;
  if (await roundExists(tournament.id, 'winners', last + 1)) return false;
  const winners = unique(ms.map(m => m.winner_team_id));
  if (winners.length <= 1) return false;
  await createMatchesFromTeams(tournament.id, winners, last + 1, 'winners');
  await repo.log(tournament.guild_id, tournament.id, 'WB_NEXT_CREATED', `Winner bracket round ${last + 1}`);
  return true;
}

async function maybeCreateNextLoserRound(tournament) {
  const all = await repo.getMatches(tournament.id);
  const wbRounds = [...new Set(all.filter(m => m.bracket_group === 'winners').map(m => m.round))].sort((a,b)=>a-b);
  const maxWbRound = wbRounds.at(-1) || 1;
  const maxPossibleLbRound = Math.max(1, maxWbRound * 2 - 2);

  for (let lbRound = 1; lbRound <= maxPossibleLbRound; lbRound++) {
    if (await roundExists(tournament.id, 'losers', lbRound)) continue;
    const built = await buildLoserRoundEntrants(tournament.id, lbRound);
    if (built.blocked) return false;
    const entrants = unique(built.entrants);
    if (entrants.length < 2) {
      // Important: do not create Mezz-vs-BYE / Kaaz-vs-BYE fake lower-bracket rounds.
      // Carry one team forward until another drop arrives or until Grand Final can be created.
      continue;
    }
    await createMatchesFromTeams(tournament.id, entrants, lbRound, 'losers');
    await repo.log(tournament.guild_id, tournament.id, 'LB_ROUND_CREATED', `Loser bracket round ${lbRound}`);
    return true;
  }
  return false;
}

async function getWinnerBracketChampion(tournamentId) {
  const all = await repo.getMatches(tournamentId);
  const rounds = [...new Set(all.filter(m => m.bracket_group === 'winners').map(m => m.round))].sort((a,b)=>a-b);
  const last = rounds.at(-1);
  if (!last) return null;
  const ms = await repo.getGroupRoundMatches(tournamentId, 'winners', last);
  if (!ms.length || !ms.every(isDone)) return null;
  const winners = unique(ms.map(m => m.winner_team_id));
  return winners.length === 1 ? winners[0] : null;
}

async function getLoserBracketChampion(tournamentId) {
  const all = await repo.getMatches(tournamentId);
  const wbRounds = [...new Set(all.filter(m => m.bracket_group === 'winners').map(m => m.round))].sort((a,b)=>a-b);
  const wbLast = wbRounds.at(-1);
  if (!wbLast) return null;
  const wbFinal = await repo.getGroupRoundMatches(tournamentId, 'winners', wbLast);
  if (!wbFinal.length || !wbFinal.every(isDone)) return null;

  if (wbLast === 1) {
    const losers = losersOfMatches(wbFinal);
    return losers.length === 1 ? losers[0] : null;
  }

  const expectedLastLbRound = Math.max(1, wbLast * 2 - 2);
  const finalLbMatches = await repo.getGroupRoundMatches(tournamentId, 'losers', expectedLastLbRound);
  if (finalLbMatches.length) {
    if (!finalLbMatches.every(isDone)) return null;
    const winners = unique(finalLbMatches.map(m => m.winner_team_id));
    return winners.length === 1 ? winners[0] : null;
  }

  // If no final LB match was needed because the remaining lower-bracket team was carried forward,
  // use that carried frontier only after the WB final is done.
  const frontier = await loserFrontierBefore(tournamentId, expectedLastLbRound + 1);
  return frontier && frontier.length === 1 ? frontier[0] : null;
}

async function maybeCreateGrandFinal(tournament) {
  const latest = await repo.getMatches(tournament.id);
  if (latest.some(m => m.bracket_group === 'grand')) return false;
  const wbChampion = await getWinnerBracketChampion(tournament.id);
  const lbChampion = await getLoserBracketChampion(tournament.id);
  if (wbChampion && lbChampion && wbChampion !== lbChampion) {
    await repo.createMatch(tournament.id, 1, 1, wbChampion, lbChampion, 'pending', null, 'grand');
    await repo.log(tournament.guild_id, tournament.id, 'GRAND_FINAL_CREATED', 'Grand final created');
    return true;
  }
  return false;
}

async function maybeFinishGrand(tournament) {
  const grandMatches = (await repo.getMatches(tournament.id)).filter(m => m.bracket_group === 'grand').sort((a,b)=>a.round-b.round);
  const grand = grandMatches.at(-1);
  if (!grand || !isDone(grand)) return false;
  const firstGrand = grandMatches[0];
  if (grandMatches.length === 1 && grand.winner_team_id === firstGrand.team2_id) {
    await repo.createMatch(tournament.id, 2, 1, firstGrand.team1_id, firstGrand.team2_id, 'pending', null, 'grand');
    await repo.log(tournament.guild_id, tournament.id, 'GRAND_FINAL_RESET_CREATED', 'Reset final created');
    return true;
  }
  await repo.updateTournament(tournament.id, { status: 'finished', winner_team_id: grand.winner_team_id });
  await repo.log(tournament.guild_id, tournament.id, 'TOURNAMENT_FINISHED', `Winner team id: ${grand.winner_team_id}`);
  return false;
}

async function createNextRoundIfReady(tournament) {
  if (!tournament || tournament.status !== 'running') return;

  let changed = true;
  let guard = 0;
  while (changed && guard++ < 60) {
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

    if (await maybeCreateNextWinnerRound(tournament)) { changed = true; continue; }
    if (await maybeCreateNextLoserRound(tournament)) { changed = true; continue; }
    if (await maybeCreateGrandFinal(tournament)) { changed = true; continue; }
    if (await maybeFinishGrand(tournament)) { changed = true; continue; }
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
