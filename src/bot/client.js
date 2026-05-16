const {
  Client,
  GatewayIntentBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField
} = require('discord.js');
const repo = require('../db/repos');
const engine = require('../engine/bracketEngine');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

function hidden(content) { return { content, flags: MessageFlags.Ephemeral }; }
function shortLabel(text) { return String(text || 'Team').slice(0, 75); }
function asBool(v) { return v ? 1 : 0; }

function isStaff(interaction, tournament = null) {
  const roleId = tournament?.staff_role_id || repo.getSettings(interaction.guildId)?.staff_role_id;
  if (!roleId) return interaction.memberPermissions?.has('ManageGuild');
  return interaction.member.roles.cache.has(roleId) || interaction.memberPermissions?.has('ManageGuild');
}
function assertStaff(interaction, tournament = null) { if (!isStaff(interaction, tournament)) throw new Error('Staff only.'); }

function getTournamentFromContext(interaction, statusAware = true) {
  const id = interaction.options?.getInteger?.('tournament_id');
  if (id) {
    const t = repo.getTournamentById(id);
    if (!t || t.guild_id !== interaction.guildId) return null;
    return t;
  }
  return repo.getTournamentForChannel(interaction.guildId, interaction.channelId) || repo.getActiveTournament(interaction.guildId) || (!statusAware ? repo.getLatestTournament(interaction.guildId) : null);
}

function teamNameFactory(tournament) {
  const teams = repo.getTeams(tournament.id);
  return id => id ? (teams.find(t => t.id === id)?.name || `Team ${id}`) : 'BYE';
}

function buildMatchButtons(tournament) {
  const teamName = teamNameFactory(tournament);
  const matches = repo.getMatches(tournament.id).filter(m => m.status === 'pending' || m.status === 'reported').slice(0, 5);
  const rows = [];
  for (const m of matches) {
    const row = new ActionRowBuilder();
    if (m.status === 'pending') {
      if (m.team1_id) row.addComponents(new ButtonBuilder().setCustomId(`report:${m.id}:${m.team1_id}`).setLabel(`Report ${shortLabel(teamName(m.team1_id))}`).setStyle(ButtonStyle.Primary));
      if (m.team2_id) row.addComponents(new ButtonBuilder().setCustomId(`report:${m.id}:${m.team2_id}`).setLabel(`Report ${shortLabel(teamName(m.team2_id))}`).setStyle(ButtonStyle.Primary));
    }
    if (m.status === 'reported') row.addComponents(new ButtonBuilder().setCustomId(`approve:${m.id}`).setLabel(`Approve #${m.id}`).setStyle(ButtonStyle.Success));
    if (row.components.length) rows.push(row);
  }
  return rows;
}

async function sendToChannel(guild, channelId, payload) {
  if (!channelId) return null;
  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (!ch) return null;
  return ch.send(payload).catch(() => null);
}

async function postBracket(interaction, tournament, note = null) {
  const text = `${note ? `${note}\n\n` : ''}${engine.renderBracket(tournament)}`;
  const components = buildMatchButtons(tournament);
  return sendToChannel(interaction.guild, tournament.bracket_channel_id, { content: text, components });
}

async function maybeCreateMatchChannels(interaction, tournament) {
  if (!tournament.auto_match_channels || !tournament.match_category_id) return;
  const matches = repo.getMatches(tournament.id).filter(m => !m.text_channel_id && m.status === 'pending');
  const teams = repo.getTeams(tournament.id);
  const teamName = id => teams.find(t => t.id === id)?.name || `team-${id}`;
  const staffRoleId = tournament.staff_role_id;
  const category = await interaction.guild.channels.fetch(tournament.match_category_id).catch(() => null);
  if (!category) return;
  for (const m of matches) {
    const safe = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 25) || 'team';
    const name = `match-${m.id}-${safe(teamName(m.team1_id))}-vs-${safe(teamName(m.team2_id))}`.slice(0, 95);
    const overwrites = [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] }
    ];
    for (const teamId of [m.team1_id, m.team2_id].filter(Boolean)) {
      const tm = teams.find(t => t.id === teamId);
      if (tm) tm.players.forEach(pid => overwrites.push({ id: pid, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }));
    }
    if (staffRoleId) overwrites.push({ id: staffRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ReadMessageHistory] });
    const textChannel = await interaction.guild.channels.create({ name, type: ChannelType.GuildText, parent: category.id, permissionOverwrites: overwrites }).catch(() => null);
    let voiceId = null;
    if (tournament.auto_voice) {
      const voice = await interaction.guild.channels.create({ name: `Voice Match ${m.id}`, type: ChannelType.GuildVoice, parent: category.id, permissionOverwrites: overwrites }).catch(() => null);
      voiceId = voice?.id || null;
    }
    if (textChannel) {
      repo.updateMatch(m.id, { text_channel_id: textChannel.id, voice_channel_id: voiceId });
      await textChannel.send({ content: `**Match #${m.id}**\n${teamName(m.team1_id)} vs ${teamName(m.team2_id)}\nReport the winner here with the buttons or use \`/reportwin match_id:${m.id}\`.`, components: buildMatchButtons(tournament).slice(0,1) });
    }
  }
}

async function archiveMatchChannel(interaction, tournament, match) {
  if (!tournament.auto_archive) return;
  if (match.text_channel_id) {
    const ch = await interaction.guild.channels.fetch(match.text_channel_id).catch(() => null);
    if (ch) await ch.setName(`done-${ch.name}`.slice(0, 100)).catch(() => null);
  }
}

function normalizeWinnerInput(input) {
  const raw = String(input || '').trim();
  return { raw, lower: raw.toLowerCase(), userId: raw.match(/^<@!?(\d+)>$/)?.[1] || raw.match(/^\d{15,25}$/)?.[0] || null };
}
function findWinnerInMatch(tournamentId, match, input) {
  const { lower, userId } = normalizeWinnerInput(input);
  const teams = repo.getTeams(tournamentId);
  const matchTeams = teams.filter(tm => [match.team1_id, match.team2_id].filter(Boolean).includes(tm.id));
  let winner = matchTeams.find(tm => tm.name.toLowerCase() === lower);
  if (!winner && userId) winner = matchTeams.find(tm => tm.players.includes(userId));
  if (!winner && lower.length >= 2) {
    const partial = matchTeams.filter(tm => tm.name.toLowerCase().includes(lower));
    if (partial.length === 1) winner = partial[0];
  }
  return { winner, matchTeams };
}

async function approveMatch(interaction, tournament, matchId) {
  const match = repo.getMatch(matchId);
  if (!tournament || !match || match.tournament_id !== tournament.id) throw new Error('Match not found.');
  if (!match.reported_winner_id) throw new Error('No winner reported for this match.');
  repo.updateMatch(matchId, { winner_team_id: match.reported_winner_id, status: 'approved' });
  await archiveMatchChannel(interaction, tournament, match);
  const fresh = repo.getTournamentById(tournament.id);
  engine.createNextRoundIfReady(fresh);
  const latest = repo.getTournamentById(tournament.id);
  await maybeCreateMatchChannels(interaction, latest);
  await postBracket(interaction, latest, `✅ Match #${matchId} approved.`);
  return latest;
}

client.once('clientReady', () => console.log(`Logged in as ${client.user.tag}`));

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isButton()) {
      const [action, matchIdRaw, teamIdRaw] = interaction.customId.split(':');
      const matchId = Number(matchIdRaw);
      const match = repo.getMatch(matchId);
      if (!match) return interaction.reply(hidden('❌ Match not found.'));
      const t = repo.getTournamentById(match.tournament_id);
      if (!t || t.guild_id !== interaction.guildId) return interaction.reply(hidden('❌ Tournament not found.'));

      if (action === 'report') {
        if (match.status !== 'pending') return interaction.reply(hidden('❌ This match is not pending.'));
        const teamId = Number(teamIdRaw);
        if (![match.team1_id, match.team2_id].includes(teamId)) return interaction.reply(hidden('❌ Team is not in this match.'));
        repo.updateMatch(matchId, { reported_winner_id: teamId, status: 'reported' });
        const team = repo.getTeam(teamId);
        await interaction.reply(`⏳ Reported winner for match #${matchId}: **${team?.name || teamId}**. Staff must approve.`);
        return postBracket(interaction, repo.getTournamentById(t.id), `⏳ Winner reported for match #${matchId}.`);
      }
      if (action === 'approve') {
        if (!isStaff(interaction, t)) return interaction.reply(hidden('❌ Staff only.'));
        await interaction.deferReply();
        await approveMatch(interaction, t, matchId);
        return interaction.editReply(`✅ Approved match #${matchId}.`);
      }
      return interaction.reply(hidden('❌ Unknown button action.'));
    }

    if (!interaction.isChatInputCommand()) return;
    const cmd = interaction.commandName;

    if (cmd === 'setupbracket') {
      const bracketChannel = interaction.options.getChannel('bracket_channel');
      const staffRole = interaction.options.getRole('staff_role');
      const category = interaction.options.getChannel('match_category');
      repo.upsertSettings(interaction.guildId, { bracketChannelId: bracketChannel?.id || null, staffRoleId: staffRole.id, matchCategoryId: category?.id || null });
      return interaction.reply(hidden(`✅ Defaults saved. Staff role: ${staffRole}${bracketChannel ? ` | Default bracket: ${bracketChannel}` : ''}`));
    }

    if (cmd === 'createbracket') {
      const name = interaction.options.getString('name');
      const teamSize = interaction.options.getInteger('team_size');
      const format = interaction.options.getString('format');
      const signup = interaction.options.getChannel('signup_channel');
      const bracket = interaction.options.getChannel('bracket_channel');
      const staff = interaction.options.getRole('staff_role');
      const matchCategory = interaction.options.getChannel('match_category');
      const checkin = interaction.options.getChannel('checkin_channel');
      const requireCheckin = interaction.options.getBoolean('require_checkin') === true;
      const t = repo.createTournament({
        guildId: interaction.guildId, name, teamSize, format, createdBy: interaction.user.id,
        bracketChannelId: bracket.id, signupChannelId: signup.id, checkinChannelId: checkin?.id || null,
        matchCategoryId: matchCategory?.id || null, staffRoleId: staff.id,
        autoMatchChannels: asBool(interaction.options.getBoolean('auto_match_channels')),
        autoVoice: asBool(interaction.options.getBoolean('auto_voice')),
        autoArchive: asBool(interaction.options.getBoolean('auto_archive')),
        requireCheckin: asBool(requireCheckin)
      });
      const note = format === 'double' ? '\n⚠️ Double Elimination is selectable and stored. Current playable engine uses Single Elimination fallback while losers bracket is completed.' : '';
      await interaction.reply(`✅ Created **${name}** (#${t.id}) as **${teamSize}v${teamSize}** (${format}).\nSignup: ${signup}\nBracket: ${bracket}\nCheck-in required: **${requireCheckin ? 'Yes' : 'No'}**${requireCheckin && checkin ? ` in ${checkin}` : ''}\nStaff: ${staff}${note}`);
      return sendToChannel(interaction.guild, bracket.id, { content: `🏆 **${name}** created.\nTournament ID: **${t.id}**\nRegister in ${signup} with \`/register\`.` });
    }

    if (cmd === 'register') {
      const t = repo.getTournamentForSignupChannel(interaction.guildId, interaction.channelId);
      if (!t) {
        const open = repo.getActiveTournaments(interaction.guildId).filter(x => x.status === 'registration');
        const hint = open.length ? `\nUse the correct signup channel: ${open.map(x => `<#${x.signup_channel_id}> (#${x.id})`).join(', ')}` : '';
        return interaction.reply(hidden(`❌ No open tournament signup in this channel.${hint}`));
      }
      const players = [];
      for (let i = 1; i <= 4; i++) { const user = interaction.options.getUser(`player${i}`); if (user) players.push(user.id); }
      if (players.length !== t.team_size) return interaction.reply(hidden(`❌ This tournament requires exactly ${t.team_size} player(s) per team.`));
      if (new Set(players).size !== players.length) return interaction.reply(hidden('❌ Same player cannot be used twice in one team.'));
      const existing = repo.getTeams(t.id);
      const name = interaction.options.getString('team_name').trim();
      if (existing.some(tm => tm.name.toLowerCase() === name.toLowerCase())) return interaction.reply(hidden('❌ This team name is already registered.'));
      const already = existing.find(tm => tm.players.some(p => players.includes(p)));
      if (already) return interaction.reply(hidden(`❌ One of these players is already registered in **${already.name}**.`));
      const team = repo.addTeam(t.id, name, players, !t.require_checkin);
      await interaction.reply(`✅ Registered **${team.name}** for **${t.name}**: ${players.map(p => `<@${p}>`).join(' ')}`);
      return postBracket(interaction, t, `✅ New registration: **${team.name}**`);
    }

    if (cmd === 'checkin') {
      const t = repo.getTournamentForCheckinChannel(interaction.guildId, interaction.channelId);
      if (!t) return interaction.reply(hidden('❌ No check-in tournament found in this channel.'));
      if (!t.require_checkin) return interaction.reply(hidden('ℹ️ Check-in is disabled for this tournament. You can start with registered teams.'));
      const name = interaction.options.getString('team_name').trim().toLowerCase();
      const team = repo.getTeams(t.id).find(tm => tm.name.toLowerCase() === name && tm.players.includes(interaction.user.id));
      if (!team) return interaction.reply(hidden('❌ Team not found, or you are not in that team.'));
      repo.updateTeam(team.id, { checked_in: 1 });
      return interaction.reply(`✅ **${team.name}** checked in for **${t.name}**.`);
    }

    if (cmd === 'startbracket') {
      let t = getTournamentFromContext(interaction);
      if (!t) return interaction.reply(hidden('❌ No tournament found. Use tournament_id if multiple events exist.'));
      assertStaff(interaction, t);
      if (t.status !== 'registration') return interaction.reply(hidden('❌ Bracket already started or not in registration.'));
      if (t.require_checkin) {
        const notChecked = repo.getTeams(t.id).filter(tm => !tm.checked_in);
        if (notChecked.length) return interaction.reply(hidden(`❌ Some teams are not checked in: ${notChecked.map(x => x.name).join(', ')}`));
      }
      if (t.format === 'double') repo.updateTournament(t.id, { format: 'single' });
      engine.seedSingleElim({ ...t, format: 'single' });
      t = repo.getTournamentById(t.id);
      await maybeCreateMatchChannels(interaction, t);
      await interaction.reply(`✅ Bracket **${t.name}** started.`);
      return postBracket(interaction, t);
    }

    if (cmd === 'bracket') {
      const t = getTournamentFromContext(interaction, false);
      if (!t) return interaction.reply(hidden('❌ No tournament found.'));
      return interaction.reply({ content: engine.renderBracket(t), components: buildMatchButtons(t) });
    }

    if (cmd === 'reportwin') {
      const matchId = interaction.options.getInteger('match_id');
      const winnerInput = interaction.options.getString('winner_team_name');
      const match = repo.getMatch(matchId);
      if (!match) return interaction.reply(hidden('❌ Match not found.'));
      const t = repo.getTournamentById(match.tournament_id);
      if (!t || t.guild_id !== interaction.guildId) return interaction.reply(hidden('❌ Tournament not found.'));
      if (match.status === 'approved' || match.status === 'bye') return interaction.reply(hidden('❌ This match is already finished.'));
      const { winner, matchTeams } = findWinnerInMatch(t.id, match, winnerInput);
      if (!winner) return interaction.reply(hidden(`❌ Winner not found in match #${matchId}. Use exact team name or mention one player.\nMatch teams: ${matchTeams.map(tm => `**${tm.name}** (${tm.players.map(p => `<@${p}>`).join(' ')})`).join(' vs ')}`));
      repo.updateMatch(matchId, { reported_winner_id: winner.id, status: 'reported' });
      await interaction.reply(`⏳ Reported winner for match #${matchId}: **${winner.name}**. Staff must approve.`);
      return postBracket(interaction, repo.getTournamentById(t.id), `⏳ Winner reported for match #${matchId}.`);
    }

    if (cmd === 'approvewin') {
      const matchId = interaction.options.getInteger('match_id');
      const match = repo.getMatch(matchId);
      const t = match ? repo.getTournamentById(match.tournament_id) : null;
      if (!t || t.guild_id !== interaction.guildId) return interaction.reply(hidden('❌ Match not found.'));
      assertStaff(interaction, t);
      await approveMatch(interaction, t, matchId);
      return interaction.reply(`✅ Approved match #${matchId}.`);
    }

    if (cmd === 'forcematchwin') {
      const matchId = interaction.options.getInteger('match_id');
      const winnerInput = interaction.options.getString('winner_team_name');
      const match = repo.getMatch(matchId);
      const t = match ? repo.getTournamentById(match.tournament_id) : null;
      if (!t || t.guild_id !== interaction.guildId) return interaction.reply(hidden('❌ Match not found.'));
      assertStaff(interaction, t);
      const { winner, matchTeams } = findWinnerInMatch(t.id, match, winnerInput);
      if (!winner) return interaction.reply(hidden(`❌ Winner not found in match #${matchId}. Teams: ${matchTeams.map(tm => tm.name).join(' vs ')}`));
      repo.updateMatch(matchId, { reported_winner_id: winner.id, winner_team_id: winner.id, status: 'approved' });
      await archiveMatchChannel(interaction, t, match);
      engine.createNextRoundIfReady(repo.getTournamentById(t.id));
      const latest = repo.getTournamentById(t.id);
      await maybeCreateMatchChannels(interaction, latest);
      await interaction.reply(`✅ Force win set for match #${matchId}: **${winner.name}**.`);
      return postBracket(interaction, latest, `✅ Force win set for match #${matchId}.`);
    }

    if (cmd === 'teamlist') {
      const t = getTournamentFromContext(interaction, false);
      if (!t) return interaction.reply(hidden('❌ No tournament found.'));
      const teams = repo.getTeams(t.id);
      if (!teams.length) return interaction.reply(hidden('No teams registered yet.'));
      return interaction.reply(`**${t.name}** (#${t.id}) teams:\n` + teams.map((tm, i) => `${i + 1}. **${tm.name}** ${tm.checked_in ? '✅' : t.require_checkin ? '⏳' : '➖'} — ${tm.players.map(p => `<@${p}>`).join(' ')}`).join('\n').slice(0, 3800));
    }

    if (cmd === 'tournaments') {
      const tournaments = repo.getActiveTournaments(interaction.guildId);
      if (!tournaments.length) return interaction.reply(hidden('No active tournaments.'));
      return interaction.reply(tournaments.map(t => `#${t.id} **${t.name}** — ${t.status} — signup <#${t.signup_channel_id}> — bracket <#${t.bracket_channel_id}> — check-in ${t.require_checkin ? 'required' : 'off'}`).join('\n').slice(0, 3900));
    }


    if (cmd === 'togglecheckin') {
      const id = interaction.options.getInteger('tournament_id');
      const required = interaction.options.getBoolean('required');
      const t = id ? repo.getTournamentById(id) : getTournamentFromContext(interaction, false);
      if (!t || t.guild_id !== interaction.guildId) return interaction.reply(hidden('❌ No tournament found.'));
      assertStaff(interaction, t);
      repo.updateTournament(t.id, { require_checkin: required ? 1 : 0 });
      if (!required) {
        for (const team of repo.getTeams(t.id)) repo.updateTeam(team.id, { checked_in: 1 });
      }
      const fresh = repo.getTournamentById(t.id);
      await interaction.reply(`✅ Check-in requirement for **${fresh.name}** is now **${required ? 'ON' : 'OFF'}**.`);
      return postBracket(interaction, fresh, `ℹ️ Check-in requirement is now **${required ? 'ON' : 'OFF'}**.`);
    }

    if (cmd === 'dqteam') {
      const matchId = interaction.options.getInteger('match_id');
      const dqName = interaction.options.getString('team_name').toLowerCase();
      const match = repo.getMatch(matchId);
      const t = match ? repo.getTournamentById(match.tournament_id) : null;
      if (!t || t.guild_id !== interaction.guildId) return interaction.reply(hidden('❌ Match not found.'));
      assertStaff(interaction, t);
      const teams = repo.getTeams(t.id);
      const dq = teams.find(tm => tm.name.toLowerCase() === dqName);
      if (!dq || ![match.team1_id, match.team2_id].includes(dq.id)) return interaction.reply(hidden('❌ Team is not in this match.'));
      const winnerId = match.team1_id === dq.id ? match.team2_id : match.team1_id;
      if (!winnerId) return interaction.reply(hidden('❌ Cannot award win because no opponent exists.'));
      repo.updateMatch(matchId, { reported_winner_id: winnerId, winner_team_id: winnerId, status: 'approved' });
      await archiveMatchChannel(interaction, t, match);
      engine.createNextRoundIfReady(repo.getTournamentById(t.id));
      const latest = repo.getTournamentById(t.id);
      await maybeCreateMatchChannels(interaction, latest);
      await interaction.reply('✅ DQ recorded. Opponent advances.');
      return postBracket(interaction, latest, `✅ DQ recorded for match #${matchId}.`);
    }

    if (cmd === 'resetbracket') {
      const id = interaction.options.getInteger('tournament_id');
      const t = id ? repo.getTournamentById(id) : getTournamentFromContext(interaction);
      if (!t || t.guild_id !== interaction.guildId) return interaction.reply(hidden('❌ No tournament found.'));
      assertStaff(interaction, t);
      repo.resetTournament(interaction.guildId, t.id);
      return interaction.reply(hidden(`✅ Tournament **${t.name}** ended/reset.`));
    }
  } catch (err) {
    console.error(err);
    const payload = hidden(`❌ Error: ${err.message}`);
    if (interaction.replied || interaction.deferred) return interaction.followUp(payload);
    return interaction.reply(payload);
  }
});

module.exports = client;
