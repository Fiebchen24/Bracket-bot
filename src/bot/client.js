const {
  Client,
  GatewayIntentBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const config = require('../config');
const repo = require('../db/repos');
const engine = require('../engine/bracketEngine');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

function hidden(content) {
  return { content, flags: MessageFlags.Ephemeral };
}

function isStaff(interaction) {
  const settings = repo.getSettings(interaction.guildId);
  if (!settings?.staff_role_id) return interaction.memberPermissions?.has('ManageGuild');
  return interaction.member.roles.cache.has(settings.staff_role_id) || interaction.memberPermissions?.has('ManageGuild');
}

function shortLabel(text) {
  return String(text || 'Team').slice(0, 75);
}

function buildMatchButtons(tournament) {
  const teams = repo.getTeams(tournament.id);
  const teamName = id => teams.find(t => t.id === id)?.name || `Team ${id}`;
  const matches = repo.getMatches(tournament.id)
    .filter(m => m.status === 'pending' || m.status === 'reported')
    .slice(0, 5);

  const rows = [];
  for (const m of matches) {
    const row = new ActionRowBuilder();
    if (m.status === 'pending') {
      if (m.team1_id) row.addComponents(new ButtonBuilder().setCustomId(`report:${m.id}:${m.team1_id}`).setLabel(`Report ${shortLabel(teamName(m.team1_id))}`).setStyle(ButtonStyle.Primary));
      if (m.team2_id) row.addComponents(new ButtonBuilder().setCustomId(`report:${m.id}:${m.team2_id}`).setLabel(`Report ${shortLabel(teamName(m.team2_id))}`).setStyle(ButtonStyle.Primary));
    }
    if (m.status === 'reported') {
      row.addComponents(new ButtonBuilder().setCustomId(`approve:${m.id}`).setLabel(`Approve #${m.id}`).setStyle(ButtonStyle.Success));
    }
    if (row.components.length) rows.push(row);
  }
  return rows;
}

async function postBracket(interaction, tournament, note = null) {
  const settings = repo.getSettings(interaction.guildId);
  const text = `${note ? `${note}\n\n` : ''}${engine.renderBracket(tournament)}`;
  const components = buildMatchButtons(tournament);
  if (settings?.bracket_channel_id) {
    const ch = await interaction.guild.channels.fetch(settings.bracket_channel_id).catch(() => null);
    if (ch) await ch.send({ content: text, components });
  }
}

function normalizeWinnerInput(input) {
  const raw = String(input || '').trim();
  return {
    raw,
    lower: raw.toLowerCase(),
    userId: raw.match(/^<@!?(\d+)>$/)?.[1] || raw.match(/^\d{15,25}$/)?.[0] || null
  };
}

function findWinnerInMatch(tournamentId, match, input) {
  const { lower, userId } = normalizeWinnerInput(input);
  const teams = repo.getTeams(tournamentId);
  const matchTeamIds = [match.team1_id, match.team2_id].filter(Boolean);
  const matchTeams = teams.filter(tm => matchTeamIds.includes(tm.id));

  let winner = matchTeams.find(tm => tm.name.toLowerCase() === lower);
  if (!winner && userId) winner = matchTeams.find(tm => Array.isArray(tm.players) && tm.players.includes(userId));
  if (!winner && lower.length >= 2) {
    const partialMatches = matchTeams.filter(tm => tm.name.toLowerCase().includes(lower));
    if (partialMatches.length === 1) winner = partialMatches[0];
  }
  return { winner, matchTeams };
}

function assertStaff(interaction) {
  if (!isStaff(interaction)) throw new Error('Staff only.');
}

async function approveMatch(interaction, tournament, matchId) {
  const match = repo.getMatch(matchId);
  if (!tournament || !match || match.tournament_id !== tournament.id) throw new Error('Match not found.');
  if (!match.reported_winner_id) throw new Error('No winner reported for this match.');
  repo.updateMatch(matchId, { winner_team_id: match.reported_winner_id, status: 'approved' });
  const fresh = repo.getActiveTournament(interaction.guildId);
  engine.createNextRoundIfReady(fresh);
  const latest = repo.getActiveTournament(interaction.guildId) || repo.getTournamentById(tournament.id);
  await postBracket(interaction, latest, `✅ Match #${matchId} approved.`);
  return latest;
}

client.once('clientReady', () => console.log(`Logged in as ${client.user.tag}`));

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isButton()) {
      const [action, matchIdRaw, teamIdRaw] = interaction.customId.split(':');
      const t = repo.getActiveTournament(interaction.guildId);
      if (!t) return interaction.reply(hidden('❌ No active tournament.'));
      const matchId = Number(matchIdRaw);
      const match = repo.getMatch(matchId);
      if (!match || match.tournament_id !== t.id) return interaction.reply(hidden('❌ Match not found.'));

      if (action === 'report') {
        if (match.status !== 'pending') return interaction.reply(hidden('❌ This match is not pending.'));
        const teamId = Number(teamIdRaw);
        if (![match.team1_id, match.team2_id].includes(teamId)) return interaction.reply(hidden('❌ Team is not in this match.'));
        repo.updateMatch(matchId, { reported_winner_id: teamId, status: 'reported' });
        const team = repo.getTeam(teamId);
        await interaction.reply(`⏳ Reported winner for match #${matchId}: **${team?.name || teamId}**. Staff must approve.`);
        return postBracket(interaction, repo.getActiveTournament(interaction.guildId), `⏳ Winner reported for match #${matchId}.`);
      }

      if (action === 'approve') {
        if (!isStaff(interaction)) return interaction.reply(hidden('❌ Staff only.'));
        await interaction.deferReply();
        await approveMatch(interaction, t, matchId);
        return interaction.editReply(`✅ Approved match #${matchId}.`);
      }
      return interaction.reply(hidden('❌ Unknown button action.'));
    }

    if (!interaction.isChatInputCommand()) return;
    const cmd = interaction.commandName;

    if (cmd === 'setupbracket') {
      const bracketChannel = interaction.options.getChannel('bracket_channel');
      const staffRole = interaction.options.getRole('staff_role');
      const category = interaction.options.getChannel('match_category');
      repo.upsertSettings(interaction.guildId, { bracketChannelId: bracketChannel.id, staffRoleId: staffRole.id, matchCategoryId: category?.id || null });
      return interaction.reply(hidden(`✅ Setup saved. Bracket channel: ${bracketChannel}, Staff role: ${staffRole}`));
    }

    if (cmd === 'createbracket') {
      assertStaff(interaction);
      const active = repo.getActiveTournament(interaction.guildId);
      if (active) return interaction.reply(hidden('❌ This server already has an active tournament. Use /resetbracket first.'));
      const name = interaction.options.getString('name');
      const teamSize = interaction.options.getInteger('team_size');
      const format = interaction.options.getString('format');
      const t = repo.createTournament(interaction.guildId, name, teamSize, format, interaction.user.id);
      const note = format === 'double' ? '\n⚠️ Double Elimination is stored as format, but the playable engine currently runs Single Elimination fallback until losers bracket is finished.' : '';
      return interaction.reply(`✅ Created **${name}** as **${teamSize}v${teamSize}** (${format}). Registration is open.\nPlayers can use: \`/register team_name player1${teamSize>=2?' player2':''}${teamSize>=3?' player3':''}${teamSize>=4?' player4':''}\`${note}`);
    }

    if (cmd === 'register') {
      const t = repo.getActiveTournament(interaction.guildId);
      if (!t || t.status !== 'registration') return interaction.reply(hidden('❌ No open registration tournament found.'));
      const players = [];
      for (let i = 1; i <= 4; i++) {
        const user = interaction.options.getUser(`player${i}`);
        if (user) players.push(user.id);
      }
      if (players.length !== t.team_size) return interaction.reply(hidden(`❌ This tournament requires exactly ${t.team_size} player(s) per team.`));
      const unique = new Set(players);
      if (unique.size !== players.length) return interaction.reply(hidden('❌ Same player cannot be used twice in one team.'));
      const existingTeams = repo.getTeams(t.id);
      const name = interaction.options.getString('team_name').trim();
      if (existingTeams.some(tm => tm.name.toLowerCase() === name.toLowerCase())) return interaction.reply(hidden('❌ This team name is already registered.'));
      const alreadyInTeam = existingTeams.find(tm => tm.players.some(p => players.includes(p)));
      if (alreadyInTeam) return interaction.reply(hidden(`❌ One of these players is already registered in **${alreadyInTeam.name}**.`));
      const team = repo.addTeam(t.id, name, players);
      return interaction.reply(`✅ Registered **${team.name}**: ${players.map(p => `<@${p}>`).join(' ')}`);
    }

    if (cmd === 'startbracket') {
      assertStaff(interaction);
      const t = repo.getActiveTournament(interaction.guildId);
      if (!t) return interaction.reply(hidden('❌ No active tournament.'));
      if (t.status !== 'registration') return interaction.reply(hidden('❌ Bracket already started or not in registration.'));
      if (t.format === 'double') repo.updateTournament(t.id, { format: 'single' });
      engine.seedSingleElim({ ...t, format: 'single' });
      const fresh = repo.getActiveTournament(interaction.guildId);
      await interaction.reply('✅ Bracket started. Match buttons were posted in the bracket channel.');
      return postBracket(interaction, fresh);
    }

    if (cmd === 'bracket') {
      const t = repo.getActiveTournament(interaction.guildId) || repo.getLatestTournament(interaction.guildId);
      if (!t) return interaction.reply(hidden('❌ No tournament found.'));
      return interaction.reply({ content: engine.renderBracket(t), components: buildMatchButtons(t) });
    }

    if (cmd === 'reportwin') {
      const t = repo.getActiveTournament(interaction.guildId);
      if (!t) return interaction.reply(hidden('❌ No active tournament.'));
      const matchId = interaction.options.getInteger('match_id');
      const winnerInput = interaction.options.getString('winner_team_name');
      const match = repo.getMatch(matchId);
      if (!match || match.tournament_id !== t.id) return interaction.reply(hidden('❌ Match not found.'));
      if (match.status === 'approved' || match.status === 'bye') return interaction.reply(hidden('❌ This match is already finished.'));
      const { winner, matchTeams } = findWinnerInMatch(t.id, match, winnerInput);
      if (!winner) return interaction.reply(hidden(`❌ Winner not found in match #${matchId}. Use exact team name or mention one player from the winning team.\nMatch teams: ${matchTeams.map(tm => `**${tm.name}** (${tm.players.map(p => `<@${p}>`).join(' ')})`).join(' vs ')}`));
      repo.updateMatch(matchId, { reported_winner_id: winner.id, status: 'reported' });
      await interaction.reply(`⏳ Reported winner for match #${matchId}: **${winner.name}**. Staff must approve with /approvewin or the approve button.`);
      return postBracket(interaction, repo.getActiveTournament(interaction.guildId), `⏳ Winner reported for match #${matchId}.`);
    }

    if (cmd === 'approvewin') {
      assertStaff(interaction);
      const t = repo.getActiveTournament(interaction.guildId);
      const matchId = interaction.options.getInteger('match_id');
      await approveMatch(interaction, t, matchId);
      return interaction.reply(`✅ Approved match #${matchId}.`);
    }

    if (cmd === 'forcematchwin') {
      assertStaff(interaction);
      const t = repo.getActiveTournament(interaction.guildId);
      if (!t) return interaction.reply(hidden('❌ No active tournament.'));
      const matchId = interaction.options.getInteger('match_id');
      const winnerInput = interaction.options.getString('winner_team_name');
      const match = repo.getMatch(matchId);
      if (!match || match.tournament_id !== t.id) return interaction.reply(hidden('❌ Match not found.'));
      const { winner, matchTeams } = findWinnerInMatch(t.id, match, winnerInput);
      if (!winner) return interaction.reply(hidden(`❌ Winner not found in match #${matchId}. Teams: ${matchTeams.map(tm => tm.name).join(' vs ')}`));
      repo.updateMatch(matchId, { reported_winner_id: winner.id, winner_team_id: winner.id, status: 'approved' });
      engine.createNextRoundIfReady(repo.getActiveTournament(interaction.guildId));
      await interaction.reply(`✅ Force win set for match #${matchId}: **${winner.name}**.`);
      return postBracket(interaction, repo.getActiveTournament(interaction.guildId) || repo.getLatestTournament(interaction.guildId), `✅ Force win set for match #${matchId}.`);
    }

    if (cmd === 'teamlist') {
      const t = repo.getActiveTournament(interaction.guildId) || repo.getLatestTournament(interaction.guildId);
      if (!t) return interaction.reply(hidden('❌ No tournament found.'));
      const teams = repo.getTeams(t.id);
      if (!teams.length) return interaction.reply(hidden('No teams registered yet.'));
      return interaction.reply(teams.map((tm, i) => `${i + 1}. **${tm.name}** — ${tm.players.map(p => `<@${p}>`).join(' ')}`).join('\n').slice(0, 3900));
    }

    if (cmd === 'dqteam') {
      assertStaff(interaction);
      const t = repo.getActiveTournament(interaction.guildId);
      const matchId = interaction.options.getInteger('match_id');
      const dqName = interaction.options.getString('team_name').toLowerCase();
      const match = repo.getMatch(matchId);
      if (!t || !match || match.tournament_id !== t.id) return interaction.reply(hidden('❌ Match not found.'));
      const teams = repo.getTeams(t.id);
      const dq = teams.find(tm => tm.name.toLowerCase() === dqName);
      if (!dq || ![match.team1_id, match.team2_id].includes(dq.id)) return interaction.reply(hidden('❌ Team is not in this match.'));
      const winnerId = match.team1_id === dq.id ? match.team2_id : match.team1_id;
      if (!winnerId) return interaction.reply(hidden('❌ Cannot award win because no opponent exists.'));
      repo.updateMatch(matchId, { winner_team_id: winnerId, status: 'approved' });
      engine.createNextRoundIfReady(repo.getActiveTournament(interaction.guildId));
      await interaction.reply('✅ DQ recorded. Opponent advances.');
      return postBracket(interaction, repo.getActiveTournament(interaction.guildId) || repo.getLatestTournament(interaction.guildId), `✅ DQ recorded for match #${matchId}.`);
    }

    if (cmd === 'resetbracket') {
      assertStaff(interaction);
      const old = repo.resetTournament(interaction.guildId);
      return interaction.reply(hidden(old ? '✅ Active tournament ended/reset.' : '❌ No active tournament found.'));
    }
  } catch (err) {
    console.error(err);
    const payload = hidden(`❌ Error: ${err.message}`);
    if (interaction.replied || interaction.deferred) return interaction.followUp(payload);
    return interaction.reply(payload);
  }
});

module.exports = client;
