const { SlashCommandBuilder } = require('discord.js');
const { getTournament } = require('../utils/storage');
const { renderBracket } = require('../utils/bracket');

module.exports = {
  data: new SlashCommandBuilder().setName('bracket').setDescription('Show the active tournament bracket.'),
  async execute(interaction) {
    await interaction.reply(renderBracket(getTournament(interaction.guildId)));
  }
};
