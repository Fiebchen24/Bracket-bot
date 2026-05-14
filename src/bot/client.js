const { Client, GatewayIntentBits } = require('discord.js');
const config = require('../config');
const repo = require('../db/repos');
const engine = require('../engine/bracketEngine');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

function isStaff(interaction) {
  const settings = repo.getSettings(interaction.guildId);
  if (!settings?.staff_role_id) return interaction.memberPermissions?.has('ManageGuild');
  return interaction.member.roles.cache.has(settings.staff_role_id) || interaction.memberPermissions?.has('ManageGuild');
}

async function postBracket(interaction, tournament) {
  const settings = repo.getSettings(interaction.guildId);
  const text = engine.renderBracket(tournament);
  if (settings?.bracket_channel_id) {
    const ch = await interaction.guild.channels.fetch(settings.bracket_channel_id).catch(() => null);
    if (ch) await ch.send({ content: text });
  }
}

client.once('ready', () => console.log(`Logged in as ${client.user.tag}`));

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  try {
    const cmd = interaction.commandName;
    if (cmd === 'setupbracket') {
      const bracketChannel = interaction.options.getChannel('bracket_channel');
      const staffRole = interaction.options.getRole('staff_role');
      const category = interaction.options.getChannel('match_category');
      repo.upsertSettings(interaction.guildId, { bracketChannelId: bracketChannel.id, staffRoleId: staffRole.id, matchCategoryId: category?.id || null });
      return interaction.reply({ content: `✅ Setup saved. Bracket channel: ${bracketChannel}, Staff role: ${staffRole}`, ephemeral: true });
    }
    if (cmd === 'createbracket') {
      if (!isStaff(interaction)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const active = repo.getActiveTournament(interaction.guildId);
      if (active) return interaction.reply({ content: '❌ This server already has an active tournament. Use /resetbracket first.', ephemeral: true });
      const name = interaction.options.getString('name');
      const teamSize = interaction.options.getInteger('team_size');
      const format = interaction.options.getString('format');
      const t = repo.createTournament(interaction.guildId, name, teamSize, format, interaction.user.id);
      const note = format === 'double' ? '\n⚠️ Double Elimination is selectable and stored; first playable engine is Single Elimination. Full losers bracket comes next.' : '';
      return interaction.reply(`✅ Created **${name}** as **${teamSize}v${teamSize}** (${format}). Registration is open.\nPlayers can use: \`/register team_name player1${teamSize>=2?' player2':''}${teamSize>=3?' player3':''}${teamSize>=4?' player4':''}\`${note}`);
    }
    if (cmd === 'register') {
      const t = repo.getActiveTournament(interaction.guildId);
      if (!t || t.status !== 'registration') return interaction.reply({ content: '❌ No open registration tournament found.', ephemeral: true });
      const players = [];
      for (let i = 1; i <= 4; i++) {
        const user = interaction.options.getUser(`player${i}`);
        if (user) players.push(user.id);
      }
      if (players.length !== t.team_size) return interaction.reply({ content: `❌ This tournament requires exactly ${t.team_size} player(s) per team.`, ephemeral: true });
      const unique = new Set(players);
      if (unique.size !== players.length) return interaction.reply({ content: '❌ Same player cannot be used twice in one team.', ephemeral: true });
      const name = interaction.options.getString('team_name');
      const team = repo.addTeam(t.id, name, players);
      return interaction.reply(`✅ Registered **${team.name}**: ${players.map(p => `<@${p}>`).join(' ')}`);
    }
    if (cmd === 'startbracket') {
      if (!isStaff(interaction)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const t = repo.getActiveTournament(interaction.guildId);
      if (!t) return interaction.reply({ content: '❌ No active tournament.', ephemeral: true });
      if (t.status !== 'registration') return interaction.reply({ content: '❌ Bracket already started or not in registration.', ephemeral: true });
      if (t.format === 'double') {
        // safe playable fallback until full losers bracket implementation is added
        repo.updateTournament(t.id, { format: 'single' });
      }
      engine.seedSingleElim({...t, format: 'single'});
      const fresh = repo.getActiveTournament(interaction.guildId);
      await interaction.reply('✅ Bracket started.');
      return postBracket(interaction, fresh);
    }
    if (cmd === 'bracket') {
      const t = repo.getActiveTournament(interaction.guildId) || repo.db?.prepare?.('') ;
      if (!t) return interaction.reply({ content: '❌ No active tournament.', ephemeral: true });
      return interaction.reply(engine.renderBracket(t));
    }
    if (cmd === 'reportwin') {
      const t = repo.getActiveTournament(interaction.guildId);
      if (!t) return interaction.reply({ content: '❌ No active tournament.', ephemeral: true });
      const matchId = interaction.options.getInteger('match_id');
      const winnerName = interaction.options.getString('winner_team_name').toLowerCase();
      const match = repo.getMatch(matchId);
      if (!match || match.tournament_id !== t.id) return interaction.reply({ content: '❌ Match not found.', ephemeral: true });
      const teams = repo.getTeams(t.id);
      const winner = teams.find(tm => tm.name.toLowerCase() === winnerName);
      if (!winner || ![match.team1_id, match.team2_id].includes(winner.id)) return interaction.reply({ content: '❌ Winner team is not in this match.', ephemeral: true });
      repo.updateMatch(matchId, { reported_winner_id: winner.id, status: 'reported' });
      return interaction.reply(`⏳ Reported winner for match #${matchId}: **${winner.name}**. Staff must approve with /approvewin.`);
    }
    if (cmd === 'approvewin') {
      if (!isStaff(interaction)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const t = repo.getActiveTournament(interaction.guildId);
      const matchId = interaction.options.getInteger('match_id');
      const match = repo.getMatch(matchId);
      if (!t || !match || match.tournament_id !== t.id) return interaction.reply({ content: '❌ Match not found.', ephemeral: true });
      if (!match.reported_winner_id) return interaction.reply({ content: '❌ No winner reported for this match.', ephemeral: true });
      repo.updateMatch(matchId, { winner_team_id: match.reported_winner_id, status: 'approved' });
      const fresh = repo.getActiveTournament(interaction.guildId);
      engine.createNextRoundIfReady(fresh);
      await interaction.reply(`✅ Approved match #${matchId}.`);
      return postBracket(interaction, repo.getActiveTournament(interaction.guildId) || fresh);
    }
    if (cmd === 'dqteam') {
      if (!isStaff(interaction)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const t = repo.getActiveTournament(interaction.guildId);
      const matchId = interaction.options.getInteger('match_id');
      const dqName = interaction.options.getString('team_name').toLowerCase();
      const match = repo.getMatch(matchId);
      if (!t || !match || match.tournament_id !== t.id) return interaction.reply({ content: '❌ Match not found.', ephemeral: true });
      const teams = repo.getTeams(t.id);
      const dq = teams.find(tm => tm.name.toLowerCase() === dqName);
      if (!dq || ![match.team1_id, match.team2_id].includes(dq.id)) return interaction.reply({ content: '❌ Team is not in this match.', ephemeral: true });
      const winnerId = match.team1_id === dq.id ? match.team2_id : match.team1_id;
      if (!winnerId) return interaction.reply({ content: '❌ Cannot award win because no opponent exists.', ephemeral: true });
      repo.updateMatch(matchId, { winner_team_id: winnerId, status: 'approved' });
      engine.createNextRoundIfReady(t);
      return interaction.reply(`✅ DQ recorded. Opponent advances.`);
    }
    if (cmd === 'resetbracket') {
      if (!isStaff(interaction)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const old = repo.resetTournament(interaction.guildId);
      return interaction.reply({ content: old ? '✅ Active tournament ended/reset.' : '❌ No active tournament found.', ephemeral: true });
    }
  } catch (err) {
    console.error(err);
    if (interaction.replied || interaction.deferred) return interaction.followUp({ content: `❌ Error: ${err.message}`, ephemeral: true });
    return interaction.reply({ content: `❌ Error: ${err.message}`, ephemeral: true });
  }
});

module.exports = client;
