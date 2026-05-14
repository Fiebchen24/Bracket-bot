const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = [
  new SlashCommandBuilder().setName('setupbracket').setDescription('Setup Bracket Bot for this server')
    .addChannelOption(o => o.setName('bracket_channel').setDescription('Channel for bracket posts').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addRoleOption(o => o.setName('staff_role').setDescription('Staff role that can approve/admin').setRequired(true))
    .addChannelOption(o => o.setName('match_category').setDescription('Optional category for match channels').setRequired(false).addChannelTypes(ChannelType.GuildCategory))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('createbracket').setDescription('Create a new tournament')
    .addStringOption(o => o.setName('name').setDescription('Tournament name').setRequired(true))
    .addIntegerOption(o => o.setName('team_size').setDescription('Team size').setRequired(true).addChoices(
      {name:'1v1', value:1},{name:'2v2', value:2},{name:'3v3', value:3},{name:'4v4', value:4}))
    .addStringOption(o => o.setName('format').setDescription('Bracket format').setRequired(true).addChoices(
      {name:'Single Elimination', value:'single'}, {name:'Double Elimination', value:'double'})),
  new SlashCommandBuilder().setName('register').setDescription('Register a team')
    .addStringOption(o => o.setName('team_name').setDescription('Team name').setRequired(true))
    .addUserOption(o => o.setName('player1').setDescription('Player 1').setRequired(true))
    .addUserOption(o => o.setName('player2').setDescription('Player 2').setRequired(false))
    .addUserOption(o => o.setName('player3').setDescription('Player 3').setRequired(false))
    .addUserOption(o => o.setName('player4').setDescription('Player 4').setRequired(false)),
  new SlashCommandBuilder().setName('startbracket').setDescription('Start the active bracket').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('bracket').setDescription('Show current bracket'),
  new SlashCommandBuilder().setName('reportwin').setDescription('Report winner for a match')
    .addIntegerOption(o => o.setName('match_id').setDescription('Match ID from /bracket').setRequired(true))
    .addStringOption(o => o.setName('winner_team_name').setDescription('Winner team name').setRequired(true)),
  new SlashCommandBuilder().setName('approvewin').setDescription('Approve a reported winner')
    .addIntegerOption(o => o.setName('match_id').setDescription('Match ID').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('dqteam').setDescription('DQ a team and award opponent if possible')
    .addIntegerOption(o => o.setName('match_id').setDescription('Match ID').setRequired(true))
    .addStringOption(o => o.setName('team_name').setDescription('Team to DQ').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('resetbracket').setDescription('End/reset active tournament').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(c => c.toJSON());
