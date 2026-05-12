const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getTournament, setTournament } = require('../utils/storage');

const FORMAT_LABELS = {
  1: '1v1',
  2: '2v2',
  3: '3v3',
  4: '4v4'
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('createbracket')
    .setDescription('Create a new bracket tournament for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o =>
      o.setName('name')
        .setDescription('Tournament name.')
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('format')
        .setDescription('Choose the bracket format / team size.')
        .setRequired(true)
        .addChoices(
          { name: '1v1 - Solo', value: 1 },
          { name: '2v2 - Duo', value: 2 },
          { name: '3v3 - Trio', value: 3 },
          { name: '4v4 - Squad', value: 4 }
        )
    )
    .addStringOption(o =>
      o.setName('type')
        .setDescription('Bracket type.')
        .setRequired(false)
        .addChoices({ name: 'Single Elimination', value: 'single_elim' })
    ),

  async execute(interaction) {
    if (getTournament(interaction.guildId)) {
      return interaction.reply({
        content: '❌ This server already has an active tournament. Use `/resetbracket` first.',
        ephemeral: true
      });
    }

    const teamSize = interaction.options.getInteger('format');

    const tournament = {
      guildId: interaction.guildId,
      name: interaction.options.getString('name').trim().slice(0, 80),
      format: FORMAT_LABELS[teamSize],
      teamSize,
      type: interaction.options.getString('type') || 'single_elim',
      status: 'registration',
      teams: [],
      rounds: [],
      createdAt: new Date().toISOString()
    };

    setTournament(interaction.guildId, tournament);

    await interaction.reply(
      `✅ Created **${tournament.name}** as **${tournament.format}**. Registration is open.\n` +
      `Players can use: \`/register team_name player1${teamSize >= 2 ? ' player2' : ''}${teamSize >= 3 ? ' player3' : ''}${teamSize >= 4 ? ' player4' : ''}\``
    );
  }
};
