const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildConfig, getTournament, setTournament } = require('../utils/storage');
const { findMatch, advanceWinner } = require('../utils/bracket');

function isStaff(interaction, config) {
  return interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild) || (config?.staffRoleId && interaction.member.roles.cache.has(config.staffRoleId));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dqteam')
    .setDescription('Disqualify a team from a specific match and advance the opponent.')
    .addStringOption(o => o.setName('match_id').setDescription('Example: R1M1').setRequired(true))
    .addStringOption(o => o.setName('team_name').setDescription('Exact team name to DQ.').setRequired(true)),
  async execute(interaction) {
    const config = getGuildConfig(interaction.guildId);
    if (!isStaff(interaction, config)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    const t = getTournament(interaction.guildId);
    if (!t) return interaction.reply({ content: '❌ No active tournament.', ephemeral: true });
    const match = findMatch(t, interaction.options.getString('match_id').toUpperCase());
    if (!match) return interaction.reply({ content: '❌ Match not found.', ephemeral: true });
    const dqName = interaction.options.getString('team_name').trim().toLowerCase();
    const teams = [match.team1, match.team2].filter(Boolean);
    const dq = teams.find(team => team.name.toLowerCase() === dqName);
    const winner = teams.find(team => team.name.toLowerCase() !== dqName);
    if (!dq || !winner) return interaction.reply({ content: '❌ Could not identify DQ team and opponent.', ephemeral: true });
    advanceWinner(t, match.id, winner, false);
    match.status = 'dq';
    setTournament(interaction.guildId, t);
    await interaction.reply(`✅ **${dq.name}** was DQ'd. **${winner.name}** advances.`);
  }
};
