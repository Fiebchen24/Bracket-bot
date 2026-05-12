const { SlashCommandBuilder } = require('discord.js');
const { getTournament, setTournament } = require('../utils/storage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Register a team for the active bracket.')
    .addStringOption(o => o.setName('team_name').setDescription('Team name.').setRequired(true))
    .addUserOption(o => o.setName('player1').setDescription('Player 1.').setRequired(true))
    .addUserOption(o => o.setName('player2').setDescription('Player 2.').setRequired(false))
    .addUserOption(o => o.setName('player3').setDescription('Player 3.').setRequired(false))
    .addUserOption(o => o.setName('player4').setDescription('Player 4.').setRequired(false)),
  async execute(interaction) {
    const t = getTournament(interaction.guildId);
    if (!t) return interaction.reply({ content: '❌ No active tournament.', ephemeral: true });
    if (t.status !== 'registration') return interaction.reply({ content: '❌ Registration is closed.', ephemeral: true });
    const members = [1,2,3,4].map(n => interaction.options.getUser(`player${n}`)?.id).filter(Boolean);
    if (members.length !== t.teamSize) return interaction.reply({ content: `❌ This tournament requires exactly ${t.teamSize} player(s) per team.`, ephemeral: true });
    if (new Set(members).size !== members.length) return interaction.reply({ content: '❌ A player cannot be listed twice.', ephemeral: true });
    const already = t.teams.find(team => team.members.some(id => members.includes(id)));
    if (already) return interaction.reply({ content: `❌ One of these players is already registered in **${already.name}**.`, ephemeral: true });
    const name = interaction.options.getString('team_name').trim().slice(0, 40);
    if (t.teams.some(team => team.name.toLowerCase() === name.toLowerCase())) return interaction.reply({ content: '❌ This team name is already taken.', ephemeral: true });
    t.teams.push({ id: `T${Date.now()}`, name, members, captainId: interaction.user.id, checkedIn: false });
    setTournament(interaction.guildId, t);
    await interaction.reply(`✅ Registered **${name}**: ${members.map(id => `<@${id}>`).join(' ')}`);
  }
};
