const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { deleteTournament } = require('../utils/storage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resetbracket')
    .setDescription('Delete the active bracket tournament for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    deleteTournament(interaction.guildId);
    await interaction.reply('✅ Active tournament reset for this server.');
  }
};
