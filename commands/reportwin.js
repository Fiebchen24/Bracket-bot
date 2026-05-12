const { SlashCommandBuilder } = require('discord.js');
const { getTournament, setTournament } = require('../utils/storage');
const { findMatch, getTeamName } = require('../utils/bracket');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reportwin')
    .setDescription('Report the winner of a match. Staff must approve it.')
    .addStringOption(o => o.setName('match_id').setDescription('Example: R1M1').setRequired(true))
    .addStringOption(o => o.setName('winner_team').setDescription('Exact team name of the winner.').setRequired(true)),
  async execute(interaction) {
    const t = getTournament(interaction.guildId);
    if (!t) return interaction.reply({ content: '❌ No active tournament.', ephemeral: true });
    const matchId = interaction.options.getString('match_id').toUpperCase();
    const winnerName = interaction.options.getString('winner_team').trim().toLowerCase();
    const match = findMatch(t, matchId);
    if (!match) return interaction.reply({ content: '❌ Match not found.', ephemeral: true });
    if (match.winner) return interaction.reply({ content: '❌ This match already has a winner.', ephemeral: true });
    const teams = [match.team1, match.team2].filter(Boolean);
    const winner = teams.find(team => team.name.toLowerCase() === winnerName);
    if (!winner) return interaction.reply({ content: `❌ Winner must be one of: ${teams.map(getTeamName).join(' / ')}`, ephemeral: true });
    const userTeam = teams.find(team => team.members.includes(interaction.user.id));
    if (!userTeam) return interaction.reply({ content: '❌ Only players in this match can report the result.', ephemeral: true });
    match.reportedWinner = winner;
    match.status = 'reported';
    setTournament(interaction.guildId, t);
    await interaction.reply(`📝 Result reported for **${match.id}**: **${winner.name}**. Staff can approve with \`/approvewin match_id:${match.id}\`.`);
  }
};
