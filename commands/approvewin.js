const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildConfig, getTournament, setTournament } = require('../utils/storage');
const { findMatch, advanceWinner, renderBracket } = require('../utils/bracket');

function isStaff(interaction, config) {
  return interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild) || (config?.staffRoleId && interaction.member.roles.cache.has(config.staffRoleId));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('approvewin')
    .setDescription('Approve a reported winner and advance the bracket.')
    .addStringOption(o => o.setName('match_id').setDescription('Example: R1M1').setRequired(true))
    .addStringOption(o => o.setName('winner_team').setDescription('Optional exact team name if no report exists.').setRequired(false)),
  async execute(interaction) {
    const config = getGuildConfig(interaction.guildId);
    if (!isStaff(interaction, config)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    const t = getTournament(interaction.guildId);
    if (!t) return interaction.reply({ content: '❌ No active tournament.', ephemeral: true });
    const matchId = interaction.options.getString('match_id').toUpperCase();
    const match = findMatch(t, matchId);
    if (!match) return interaction.reply({ content: '❌ Match not found.', ephemeral: true });
    let winner = match.reportedWinner;
    const forcedName = interaction.options.getString('winner_team')?.trim().toLowerCase();
    if (forcedName) winner = [match.team1, match.team2].filter(Boolean).find(team => team.name.toLowerCase() === forcedName);
    if (!winner) return interaction.reply({ content: '❌ No reported winner found. Add winner_team to force approve.', ephemeral: true });
    advanceWinner(t, matchId, winner, false);
    const finalRound = t.rounds[t.rounds.length - 1];
    if (finalRound?.[0]?.winner) t.status = 'completed';
    setTournament(interaction.guildId, t);
    const msg = renderBracket(t);
    if (config?.bracketChannelId) {
      const channel = await interaction.guild.channels.fetch(config.bracketChannelId).catch(() => null);
      if (channel) await channel.send(msg);
    }
    await interaction.reply(`✅ Approved **${winner.name}** for **${matchId}**.${t.status === 'completed' ? `\n🏆 Tournament winner: **${winner.name}**` : ''}`);
  }
};
