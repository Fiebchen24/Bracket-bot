const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = [
  new SlashCommandBuilder().setName('setupbracket').setDescription('Set default Bracket Bot settings for this server')
    .addRoleOption(o => o.setName('staff_role').setDescription('Default staff role').setRequired(true))
    .addChannelOption(o => o.setName('bracket_channel').setDescription('Default bracket channel').setRequired(false).addChannelTypes(ChannelType.GuildText))
    .addChannelOption(o => o.setName('match_category').setDescription('Default match category').setRequired(false).addChannelTypes(ChannelType.GuildCategory))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder().setName('createbracket').setDescription('Create a tournament with flexible event channels')
    .addStringOption(o => o.setName('name').setDescription('Tournament name').setRequired(true))
    .addIntegerOption(o => o.setName('team_size').setDescription('Team size').setRequired(true).addChoices(
      {name:'1v1', value:1},{name:'2v2', value:2},{name:'3v3', value:3},{name:'4v4', value:4}))
    .addStringOption(o => o.setName('format').setDescription('Bracket format').setRequired(true).addChoices(
      {name:'Single Elimination', value:'single'}, {name:'Double Elimination', value:'double'}))
    .addChannelOption(o => o.setName('signup_channel').setDescription('Channel where teams register').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption(o => o.setName('bracket_channel').setDescription('Channel where the bracket is posted').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addRoleOption(o => o.setName('staff_role').setDescription('Staff role for this tournament').setRequired(true))
    .addRoleOption(o => o.setName('registration_role').setDescription('Optional role assigned to every registered player').setRequired(false))
    .addChannelOption(o => o.setName('match_category').setDescription('Category where match channels are created').setRequired(false).addChannelTypes(ChannelType.GuildCategory))
    .addChannelOption(o => o.setName('checkin_channel').setDescription('Optional check-in channel').setRequired(false).addChannelTypes(ChannelType.GuildText))
    .addBooleanOption(o => o.setName('require_checkin').setDescription('Require teams to check in before starting?').setRequired(false))
    .addBooleanOption(o => o.setName('auto_match_channels').setDescription('Create text channels for matches?').setRequired(false))
    .addBooleanOption(o => o.setName('auto_voice').setDescription('Create voice channels for matches?').setRequired(false))
    .addBooleanOption(o => o.setName('auto_archive').setDescription('Archive match channels after approval?').setRequired(false))
    .addBooleanOption(o => o.setName('cleanup_roles').setDescription('Remove registration role when tournament ends?').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder().setName('register').setDescription('Register in the tournament signup channel. No team name needed.')
    .addUserOption(o => o.setName('player1').setDescription('Player 1 / Team display name').setRequired(true))
    .addUserOption(o => o.setName('player2').setDescription('Player 2').setRequired(false))
    .addUserOption(o => o.setName('player3').setDescription('Player 3').setRequired(false))
    .addUserOption(o => o.setName('player4').setDescription('Player 4').setRequired(false)),

  new SlashCommandBuilder().setName('checkin').setDescription('Check in your registered team for the tournament'),

  new SlashCommandBuilder().setName('startbracket').setDescription('Start a tournament').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(o => o.setName('tournament_id').setDescription('Optional tournament ID if multiple tournaments exist').setRequired(false)),

  new SlashCommandBuilder().setName('bracket').setDescription('Show bracket')
    .addIntegerOption(o => o.setName('tournament_id').setDescription('Optional tournament ID').setRequired(false)),

  new SlashCommandBuilder().setName('reportwin').setDescription('Report winner for a match')
    .addIntegerOption(o => o.setName('match_id').setDescription('Match ID from /bracket').setRequired(true))
    .addStringOption(o => o.setName('winner').setDescription('Winner display name OR mention one winning player').setRequired(true)),

  new SlashCommandBuilder().setName('approvewin').setDescription('Approve a reported winner')
    .addIntegerOption(o => o.setName('match_id').setDescription('Match ID').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder().setName('forcematchwin').setDescription('Staff: set/approve a winner instantly')
    .addIntegerOption(o => o.setName('match_id').setDescription('Match ID').setRequired(true))
    .addStringOption(o => o.setName('winner').setDescription('Winner display name OR mention one winning player').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder().setName('teamlist').setDescription('Show registered teams')
    .addIntegerOption(o => o.setName('tournament_id').setDescription('Optional tournament ID').setRequired(false)),

  new SlashCommandBuilder().setName('tournaments').setDescription('List active tournaments on this server'),

  new SlashCommandBuilder().setName('togglecheckin').setDescription('Staff: turn check-in requirement on or off')
    .addBooleanOption(o => o.setName('required').setDescription('Require check-in?').setRequired(true))
    .addIntegerOption(o => o.setName('tournament_id').setDescription('Optional tournament ID').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder().setName('dqteam').setDescription('DQ a team and award opponent if possible')
    .addIntegerOption(o => o.setName('match_id').setDescription('Match ID').setRequired(true))
    .addStringOption(o => o.setName('team').setDescription('Team display name or mention a player').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder().setName('resetbracket').setDescription('End/reset a tournament').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(o => o.setName('tournament_id').setDescription('Optional tournament ID').setRequired(false))
].map(c => c.toJSON());
