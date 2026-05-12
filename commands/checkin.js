const { SlashCommandBuilder } = require('discord.js');
const { getTournament, setTournament } = require('../utils/storage');

module.exports = {
  data: new SlashCommandBuilder().setName('checkin').setDescription('Check in your registered team.'),
  async execute(interaction) {
    const t = getTournament(interaction.guildId);
    if (!t) return interaction.reply({ content: '❌ No active tournament.', ephemeral: true });
    if (t.status !== 'registration') return interaction.reply({ content: '❌ Check-in is closed.', ephemeral: true });
    const team = t.teams.find(team => team.members.includes(interaction.user.id) || team.captainId === interaction.user.id);
    if (!team) return interaction.reply({ content: '❌ You are not registered in this tournament.', ephemeral: true });
    team.checkedIn = true;
    setTournament(interaction.guildId, t);
    await interaction.reply(`✅ **${team.name}** is checked in.`);
  }
};
