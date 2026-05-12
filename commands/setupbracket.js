const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { setGuildConfig } = require('../utils/storage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setupbracket')
    .setDescription('Set up bracket channels and staff role for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption(o => o.setName('staff_role').setDescription('Role allowed to approve results and manage brackets.').setRequired(true))
    .addChannelOption(o => o.setName('bracket_channel').setDescription('Channel where bracket updates will be posted.').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addChannelOption(o => o.setName('match_category').setDescription('Optional category for match channels.').addChannelTypes(ChannelType.GuildCategory).setRequired(false)),
  async execute(interaction) {
    const staffRole = interaction.options.getRole('staff_role');
    const bracketChannel = interaction.options.getChannel('bracket_channel');
    const matchCategory = interaction.options.getChannel('match_category');
    setGuildConfig(interaction.guildId, { staffRoleId: staffRole.id, bracketChannelId: bracketChannel.id, matchCategoryId: matchCategory?.id || null });
    await interaction.reply(`✅ Bracket setup saved.\nStaff: ${staffRole}\nBracket Channel: ${bracketChannel}${matchCategory ? `\nMatch Category: ${matchCategory.name}` : ''}`);
  }
};
