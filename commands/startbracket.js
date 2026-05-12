const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getGuildConfig, getTournament, setTournament } = require('../utils/storage');
const { createSingleElimBracket, renderBracket } = require('../utils/bracket');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('startbracket')
    .setDescription('Close registration and start the bracket.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption(o => o.setName('checked_in_only').setDescription('Use only checked-in teams?').setRequired(false))
    .addBooleanOption(o => o.setName('create_match_channels').setDescription('Create Discord channels for first round matches?').setRequired(false)),
  async execute(interaction) {
    const config = getGuildConfig(interaction.guildId);
    const t = getTournament(interaction.guildId);
    if (!t) return interaction.reply({ content: '❌ No active tournament.', ephemeral: true });
    if (t.status !== 'registration') return interaction.reply({ content: '❌ Bracket has already started.', ephemeral: true });
    const checkedOnly = interaction.options.getBoolean('checked_in_only') ?? true;
    const teams = checkedOnly ? t.teams.filter(team => team.checkedIn) : t.teams;
    if (teams.length < 2) return interaction.reply({ content: '❌ Need at least 2 teams to start.', ephemeral: true });
    t.teams = teams;
    t.rounds = createSingleElimBracket(teams, true);
    t.status = 'running';
    setTournament(interaction.guildId, t);

    if (interaction.options.getBoolean('create_match_channels') && config?.matchCategoryId) {
      const firstRound = t.rounds[0].filter(m => m.team1 && m.team2);
      for (const m of firstRound) {
        await interaction.guild.channels.create({
          name: `${m.id.toLowerCase()}-${m.team1.name}-vs-${m.team2.name}`.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 90),
          type: ChannelType.GuildText,
          parent: config.matchCategoryId,
          topic: `${m.id}: ${m.team1.name} vs ${m.team2.name}`
        }).catch(() => null);
      }
    }

    const msg = renderBracket(t);
    if (config?.bracketChannelId) {
      const channel = await interaction.guild.channels.fetch(config.bracketChannelId).catch(() => null);
      if (channel) await channel.send(msg);
    }
    await interaction.reply('✅ Bracket started.');
  }
};
