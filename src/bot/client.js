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
function displayNameFromUser(user) { return user.globalName || user.displayName || user.username || `Player-${user.id}`; }
function playerDetailFromUser(user) { return { id: user.id, displayName: displayNameFromUser(user), username: user.username || displayNameFromUser(user), avatarUrl: user.displayAvatarURL?.({ extension: 'png', size: 64 }) || null }; }
function safeChannelPart(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 25) || 'team'; }

async function isStaff(interaction, tournament = null) {
  const settings = await repo.getSettings(interaction.guildId);
  const roleId = tournament?.staff_role_id || settings?.staff_role_id;
  if (!roleId) return interaction.memberPermissions?.has('ManageGuild');
  return interaction.member.roles.cache.has(roleId) || interaction.memberPermissions?.has('ManageGuild');
}
async function assertStaff(interaction, tournament = null) { if (!(await isStaff(interaction, tournament))) throw new Error('Staff only.'); }

async function getTournamentFromContext(interaction, statusAware = true) {
  const id = interaction.options?.getInteger?.('tournament_id');
  if (id) {
    const t = await repo.getTournamentById(id);
    if (!t || t.guild_id !== interaction.guildId) return null;
    return t;
  }
  return await repo.getTournamentForChannel(interaction.guildId, interaction.channelId) || await repo.getActiveTournament(interaction.guildId) || (!statusAware ? await repo.getLatestTournament(interaction.guildId) : null);
}
async function teamNameFactory(tournament) {
  const teams = await repo.getTeams(tournament.id);
  return id => id ? (teams.find(t => t.id === id)?.name || `Team ${id}`) : 'BYE';
}
function selectOpenMatchesForTournament(tournament, matches) {
  const open = matches.filter(m => m.status === 'pending' || m.status === 'reported');
  if (tournament?.format === 'round_robin') {
    const pendingRounds = [...new Set(open.map(m => m.round))].sort((a,b)=>a-b);
    const currentRound = pendingRounds[0];
    return currentRound ? open.filter(m => m.round === currentRound) : [];
  }
  return open;
}

async function buildMatchButtons(tournament) {
  const teamName = await teamNameFactory(tournament);
  const matches = selectOpenMatchesForTournament(tournament, await repo.getMatches(tournament.id)).slice(0, 5);
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

async function buildButtonsForMatch(tournament, match) {
  const teamName = await teamNameFactory(tournament);
  const row = new ActionRowBuilder();
  if (match.status === 'pending') {
    if (match.team1_id) row.addComponents(new ButtonBuilder().setCustomId(`report:${match.id}:${match.team1_id}`).setLabel(`Report ${shortLabel(teamName(match.team1_id))}`).setStyle(ButtonStyle.Primary));
    if (match.team2_id) row.addComponents(new ButtonBuilder().setCustomId(`report:${match.id}:${match.team2_id}`).setLabel(`Report ${shortLabel(teamName(match.team2_id))}`).setStyle(ButtonStyle.Primary));
  }
  if (match.status === 'reported') row.addComponents(new ButtonBuilder().setCustomId(`approve:${match.id}`).setLabel(`Approve #${match.id}`).setStyle(ButtonStyle.Success));
  return row.components.length ? [row] : [];
}
async function sendToChannel(guild, channelId, payload) {
  if (!channelId) return null;
  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (!ch) return null;
  return ch.send(payload).catch(() => null);
}
async function postBracket(interaction, tournament, note = null) {
  const fresh = await repo.getTournamentById(tournament.id) || tournament;
  const text = `${note ? `${note}\n\n` : ''}${await engine.renderBracket(fresh)}`;
  const components = await buildMatchButtons(fresh);
  return sendToChannel(interaction.guild, fresh.bracket_channel_id, { content: text, components });
}
async function assignRegistrationRole(interaction, tournament, players) {
  if (!tournament.registration_role_id) return [];
  const results = [];
  for (const playerId of players) {
    const member = await interaction.guild.members.fetch(playerId).catch(() => null);
    if (!member) { results.push(`<@${playerId}> not found`); continue; }
    await member.roles.add(tournament.registration_role_id).then(() => results.push(`<@${playerId}> role added`)).catch(() => results.push(`<@${playerId}> role failed`));
  }
  return results;
}
async function cleanupRegistrationRoles(interaction, tournament) {
  if (!tournament.registration_role_id || !tournament.cleanup_roles) return;
  const players = [...new Set((await repo.getTeams(tournament.id)).flatMap(t => t.players))];
  for (const playerId of players) {
    const member = await interaction.guild.members.fetch(playerId).catch(() => null);
    if (member) await member.roles.remove(tournament.registration_role_id).catch(() => null);
  }
}

async function removeRegistrationRoleFromPlayers(interaction, tournament, players) {
  if (!tournament.registration_role_id) return;
  for (const playerId of players || []) {
    const member = await interaction.guild.members.fetch(playerId).catch(() => null);
    if (member) await member.roles.remove(tournament.registration_role_id).catch(() => null);
  }
}
async function maybeCreateMatchChannels(interaction, tournament, reason = 'sync') {
  if (!tournament) return { created: 0, skipped: 'no tournament' };
  if (!tournament.auto_match_channels) return { created: 0, skipped: 'auto_match_channels disabled' };
  if (!tournament.match_category_id) return { created: 0, skipped: 'match_category_id missing' };

  const allMatches = await repo.getMatches(tournament.id);
  const selectedOpen = selectOpenMatchesForTournament(tournament, allMatches);
  const matches = selectedOpen
    .filter(m => !m.text_channel_id && (m.status === 'pending' || m.status === 'reported') && m.team1_id && m.team2_id);

  if (!matches.length) return { created: 0, skipped: tournament.format === 'round_robin' ? 'no open matches without channels in current round' : 'no open matches without channels' };

  const teams = await repo.getTeams(tournament.id);
  const teamName = id => teams.find(t => t.id === id)?.name || `team-${id}`;
  const staffRoleId = tournament.staff_role_id;
  const category = await interaction.guild.channels.fetch(tournament.match_category_id).catch(() => null);
  if (!category) {
    await sendToChannel(interaction.guild, tournament.bracket_channel_id, { content: `⚠️ Could not create match channels for **${tournament.name}**: Match category not found.` });
    return { created: 0, skipped: 'category not found' };
  }

  let created = 0;
  for (const m of matches) {
    const name = `match-${String(m.id).padStart(2,'0')}-${safeChannelPart(teamName(m.team1_id))}-vs-${safeChannelPart(teamName(m.team2_id))}`.slice(0, 95);
    const overwrites = [{ id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] }];
    for (const teamId of [m.team1_id, m.team2_id].filter(Boolean)) {
      const tm = teams.find(t => t.id === teamId);
      if (tm) tm.players.forEach(pid => overwrites.push({ id: pid, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }));
    }
    if (staffRoleId) overwrites.push({ id: staffRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ReadMessageHistory] });

    let textChannel = null;
    try {
      textChannel = await interaction.guild.channels.create({ name, type: ChannelType.GuildText, parent: category.id, permissionOverwrites: overwrites });
    } catch (err) {
      await repo.log(tournament.guild_id, tournament.id, 'MATCH_CHANNEL_CREATE_FAILED', `Match ${m.id}: ${err.message}`);
      await sendToChannel(interaction.guild, tournament.bracket_channel_id, { content: `⚠️ Could not create channel for match #${m.id}: ${err.message}` });
      continue;
    }

    let voiceId = null;
    if (tournament.auto_voice) {
      const voice = await interaction.guild.channels.create({ name: `Voice Match ${m.id}`, type: ChannelType.GuildVoice, parent: category.id, permissionOverwrites: overwrites }).catch(async err => {
        await repo.log(tournament.guild_id, tournament.id, 'MATCH_VOICE_CREATE_FAILED', `Match ${m.id}: ${err.message}`);
        return null;
      });
      voiceId = voice?.id || null;
    }

    await repo.updateMatch(m.id, { text_channel_id: textChannel.id, voice_channel_id: voiceId });
    const freshMatch = await repo.getMatch(m.id);
    await textChannel.send({
      content: `🏆 **Match #${m.id}** (${m.bracket_group || 'winners'} bracket)\n**${teamName(m.team1_id)}** vs **${teamName(m.team2_id)}**\nReport the winner here with the buttons or use \`/reportwin match_id:${m.id}\`.`,
      components: await buildButtonsForMatch(tournament, freshMatch)
    }).catch(() => null);
    await repo.log(tournament.guild_id, tournament.id, 'MATCH_CHANNEL_CREATED', `Match ${m.id} via ${reason}: #${textChannel.name}`);
    created++;
  }
  if (created) {
    await sendToChannel(interaction.guild, tournament.bracket_channel_id, { content: `✅ Created **${created}** match channel${created === 1 ? '' : 's'} for **${tournament.name}**.` });
  }
  return { created };
}

async function cleanupFinishedMatchChannels(interaction, tournament) {
  if (!tournament?.auto_archive) return { cleaned: 0 };
  const matches = (await repo.getMatches(tournament.id)).filter(m => (m.status === 'approved' || m.status === 'bye') && (m.text_channel_id || m.voice_channel_id));
  let cleaned = 0;
  for (const match of matches) {
    if (match.voice_channel_id) {
      const v = await interaction.guild.channels.fetch(match.voice_channel_id).catch(() => null);
      if (v) await v.delete(`Match #${match.id} finished`).catch(async err => {
        await repo.log(tournament.guild_id, tournament.id, 'MATCH_VOICE_DELETE_FAILED', `Match ${match.id}: ${err.message}`);
      });
    }
    if (match.text_channel_id) {
      const ch = await interaction.guild.channels.fetch(match.text_channel_id).catch(() => null);
      if (ch) {
        await ch.delete(`Match #${match.id} finished`).catch(async err => {
          // If deletion fails, fall back to a single done- prefix, never done-done-done.
          await ch.setName(ch.name.startsWith('done-') ? ch.name : `done-${ch.name}`.slice(0, 100)).catch(() => null);
          await repo.log(tournament.guild_id, tournament.id, 'MATCH_CHANNEL_DELETE_FAILED', `Match ${match.id}: ${err.message}`);
        });
      }
    }
    await repo.updateMatch(match.id, { text_channel_id: null, voice_channel_id: null });
    cleaned++;
  }

  // Clean older leftovers from previous versions inside this event category.
  if (tournament.match_category_id) {
    const category = await interaction.guild.channels.fetch(tournament.match_category_id).catch(() => null);
    if (category) {
      const children = interaction.guild.channels.cache.filter(ch => ch.parentId === category.id);
      for (const ch of children.values()) {
        if (ch.name?.startsWith('done-')) {
          await ch.delete('Cleaning archived match channel leftovers').catch(() => null);
          cleaned++;
        }
      }
    }
  }

  if (cleaned) await repo.log(tournament.guild_id, tournament.id, 'MATCH_CHANNELS_CLEANED', `${cleaned} finished/archived channel set(s) cleaned`);
  return { cleaned };
}

async function syncTournamentChannels(interaction, tournament, reason = 'manual') {
  const cleanup = await cleanupFinishedMatchChannels(interaction, tournament);
  const latest = await repo.getTournamentById(tournament.id);
  const create = await maybeCreateMatchChannels(interaction, latest, reason);
  return { cleanup, create };
}
async function archiveMatchChannel(interaction, tournament, match) {
  // v8.7: channel cleanup is centralized in syncTournamentChannels() to prevent
  // missing channels and repeated done-done-done prefixes.
  return;
}

function normalizeWinnerInput(input) {
  const raw = String(input || '').trim();
  return { raw, lower: raw.toLowerCase(), userId: raw.match(/^<@!?(\d+)>$/)?.[1] || raw.match(/^\d{15,25}$/)?.[0] || null };
}
async function findWinnerInMatch(tournamentId, match, input) {
  const { lower, userId } = normalizeWinnerInput(input);
  const teams = await repo.getTeams(tournamentId);
  const matchTeams = teams.filter(tm => [match.team1_id, match.team2_id].filter(Boolean).includes(tm.id));
  let winner = matchTeams.find(tm => tm.name.toLowerCase() === lower);
  if (!winner && userId) winner = matchTeams.find(tm => tm.players.includes(userId));
  if (!winner && lower.length >= 2) {
    const partial = matchTeams.filter(tm => tm.name.toLowerCase().includes(lower));
    if (partial.length === 1) winner = partial[0];
  }
  return { winner, matchTeams };
}
async function findTeamInTournament(tournamentId, input) {
  const { lower, userId } = normalizeWinnerInput(input);
  const teams = await repo.getTeams(tournamentId);
  let team = teams.find(tm => tm.name.toLowerCase() === lower);
  if (!team && userId) team = teams.find(tm => tm.players.includes(userId));
  if (!team && lower.length >= 2) {
    const partial = teams.filter(tm => tm.name.toLowerCase().includes(lower));
    if (partial.length === 1) team = partial[0];
  }
  return team;
}
async function approveMatch(interaction, tournament, matchId) {
  const match = await repo.getMatch(matchId);
  if (!tournament || !match || match.tournament_id !== tournament.id) throw new Error('Match not found.');
  if (!match.reported_winner_id) throw new Error('No winner reported for this match.');
  await repo.updateMatch(matchId, { winner_team_id: match.reported_winner_id, status: 'approved' });
  await archiveMatchChannel(interaction, tournament, match);
  await engine.createNextRoundIfReady(await repo.getTournamentById(tournament.id));
  const latest = await repo.getTournamentById(tournament.id);
  await syncTournamentChannels(interaction, latest, `approve match ${matchId}`);
  await postBracket(interaction, latest, `✅ Match #${matchId} approved.`);
  return latest;
}

client.once('clientReady', () => console.log(`Logged in as ${client.user.tag}`));

client.on('error', err => console.error('Discord client error:', err));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));
process.on('uncaughtException', err => console.error('Uncaught exception:', err));

async function safeInteractionError(interaction, message) {
  const payload = hidden(message);
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(e => console.error('Failed to follow up interaction error:', e?.message || e));
    } else {
      await interaction.reply(payload).catch(e => console.error('Failed to reply interaction error:', e?.message || e));
    }
  } catch (e) {
    console.error('Failed to send interaction error:', e?.message || e);
  }
}

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isButton()) {
      const [action, matchIdRaw, teamIdRaw] = interaction.customId.split(':');
      const matchId = Number(matchIdRaw);
      const match = await repo.getMatch(matchId);
      if (!match) return interaction.reply(hidden('❌ Match not found.'));
      const t = await repo.getTournamentById(match.tournament_id);
      if (!t || t.guild_id !== interaction.guildId) return interaction.reply(hidden('❌ Tournament not found.'));
      if (action === 'report') {
        if (match.status !== 'pending') return interaction.reply(hidden('❌ This match is not pending.'));
        const teamId = Number(teamIdRaw);
        if (![match.team1_id, match.team2_id].includes(teamId)) return interaction.reply(hidden('❌ Team is not in this match.'));
        await repo.updateMatch(matchId, { reported_winner_id: teamId, status: 'reported' });
        const team = await repo.getTeam(teamId);
        await interaction.reply(`⏳ Reported winner for match #${matchId}: **${team?.name || teamId}**. Staff must approve.`);
        return postBracket(interaction, await repo.getTournamentById(t.id), `⏳ Winner reported for match #${matchId}.`);
      }
      if (action === 'approve') {
        if (!(await isStaff(interaction, t))) return interaction.reply(hidden('❌ Staff only.'));
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
      await repo.upsertSettings(interaction.guildId, { bracketChannelId: bracketChannel?.id || null, staffRoleId: staffRole.id, matchCategoryId: category?.id || null });
      return interaction.reply(hidden(`✅ Defaults saved. Staff role: ${staffRole}${bracketChannel ? ` | Default bracket: ${bracketChannel}` : ''}`));
    }

    if (cmd === 'createbracket') {
      const name = interaction.options.getString('name');
      const teamSize = interaction.options.getInteger('team_size');
      const format = interaction.options.getString('format');
      const signup = interaction.options.getChannel('signup_channel');
      const bracket = interaction.options.getChannel('bracket_channel');
      const staff = interaction.options.getRole('staff_role');
      const registrationRole = interaction.options.getRole('registration_role');
      const matchCategory = interaction.options.getChannel('match_category');
      const checkin = interaction.options.getChannel('checkin_channel');
      const requireCheckin = interaction.options.getBoolean('require_checkin') === true;
      const t = await repo.createTournament({
        guildId: interaction.guildId, name, teamSize, format, createdBy: interaction.user.id,
        bracketChannelId: bracket.id, signupChannelId: signup.id, checkinChannelId: checkin?.id || null,
        matchCategoryId: matchCategory?.id || null, staffRoleId: staff.id,
        autoMatchChannels: asBool(interaction.options.getBoolean('auto_match_channels')),
        autoVoice: asBool(interaction.options.getBoolean('auto_voice')),
        autoArchive: asBool(interaction.options.getBoolean('auto_archive')),
        requireCheckin: asBool(requireCheckin),
        registrationRoleId: registrationRole?.id || null,
        cleanupRoles: asBool(interaction.options.getBoolean('cleanup_roles'))
      });
      await interaction.reply(`✅ Created **${name}** (#${t.id}) as **${teamSize}v${teamSize}** (${format}).\nSignup: ${signup}\nBracket: ${bracket}\nCheck-in required: **${requireCheckin ? 'Yes' : 'No'}**${requireCheckin && checkin ? ` in ${checkin}` : ''}\nStaff: ${staff}${registrationRole ? `\nRegistration role: ${registrationRole}` : ''}`);
      return sendToChannel(interaction.guild, bracket.id, { content: `🏆 **${name}** created.\nTournament ID: **${t.id}**\nRegister in ${signup} with \`/register\`. No team name needed — first player becomes the display name.` });
    }

    if (cmd === 'register') {
      const t = await repo.getTournamentForSignupChannel(interaction.guildId, interaction.channelId);
      if (!t) {
        const open = (await repo.getActiveTournaments(interaction.guildId)).filter(x => x.status === 'registration');
        const hint = open.length ? `\nUse the correct signup channel: ${open.map(x => `<#${x.signup_channel_id}> (#${x.id})`).join(', ')}` : '';
        return interaction.reply(hidden(`❌ No open tournament signup in this channel.${hint}`));
      }
      const users = [];
      for (let i = 1; i <= 4; i++) { const user = interaction.options.getUser(`player${i}`); if (user) users.push(user); }
      const players = users.map(u => u.id);
      const playerDetails = users.map(playerDetailFromUser);
      if (players.length !== t.team_size) return interaction.reply(hidden(`❌ This tournament requires exactly ${t.team_size} player(s) per team.`));
      if (new Set(players).size !== players.length) return interaction.reply(hidden('❌ Same player cannot be used twice in one team.'));
      const existing = await repo.getTeams(t.id);
      const already = existing.find(tm => tm.players.some(p => players.includes(p)));
      if (already) return interaction.reply(hidden(`❌ One of these players is already registered in **${already.name}**.`));
      let baseName = displayNameFromUser(users[0]);
      let name = baseName;
      let n = 2;
      while (existing.some(tm => tm.name.toLowerCase() === name.toLowerCase())) name = `${baseName}-${n++}`;
      const team = await repo.addTeam(t.id, name, playerDetails, !t.require_checkin);
      const roleResults = await assignRegistrationRole(interaction, t, players);
      await interaction.reply(`✅ Registered **${team.name}** for **${t.name}**: ${players.map(p => `<@${p}>`).join(' ')}${t.registration_role_id ? `\nRole: <@&${t.registration_role_id}> assigned.` : ''}`);
      if (roleResults.some(r => r.includes('failed'))) await interaction.followUp(hidden(`⚠️ Role notes: ${roleResults.join(', ')}`));
      return postBracket(interaction, t, `✅ New registration: **${team.name}**`);
    }

    if (cmd === 'checkin') {
      const t = await repo.getTournamentForCheckinChannel(interaction.guildId, interaction.channelId);
      if (!t) return interaction.reply(hidden('❌ No check-in tournament found in this channel.'));
      if (!t.require_checkin) return interaction.reply(hidden('ℹ️ Check-in is disabled for this tournament. You can start with registered teams.'));
      const team = (await repo.getTeams(t.id)).find(tm => tm.players.includes(interaction.user.id));
      if (!team) return interaction.reply(hidden('❌ You are not registered in this tournament.'));
      await repo.updateTeam(team.id, { checked_in: 1 });
      return interaction.reply(`✅ **${team.name}** checked in for **${t.name}**.`);
    }

    if (cmd === 'startbracket') {
      let t = await getTournamentFromContext(interaction);
      if (!t) return interaction.reply(hidden('❌ No tournament found. Use tournament_id if multiple events exist.'));
      await assertStaff(interaction, t);
      if (t.status !== 'registration') return interaction.reply(hidden('❌ Bracket already started or not in registration.'));
      if (t.require_checkin) {
        const notChecked = (await repo.getTeams(t.id)).filter(tm => !tm.checked_in);
        if (notChecked.length) return interaction.reply(hidden(`❌ Some teams are not checked in: ${notChecked.map(x => x.name).join(', ')}`));
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await engine.startBracket(t);
      t = await repo.getTournamentById(t.id);
      const syncResult = await syncTournamentChannels(interaction, t, 'start bracket');
      await interaction.editReply(`✅ Bracket **${t.name}** started. Created match channels: **${syncResult.create.created || 0}**. Cleaned: **${syncResult.cleanup.cleaned || 0}**.`);
      return postBracket(interaction, t);
    }

    if (cmd === 'bracket') {
      const t = await getTournamentFromContext(interaction, false);
      if (!t) return interaction.reply(hidden('❌ No tournament found.'));
      return interaction.reply({ content: await engine.renderBracket(t), components: await buildMatchButtons(t) });
    }

    if (cmd === 'reportwin') {
      const matchId = interaction.options.getInteger('match_id');
      const winnerInput = interaction.options.getString('winner');
      const match = await repo.getMatch(matchId);
      if (!match) return interaction.reply(hidden('❌ Match not found.'));
      const t = await repo.getTournamentById(match.tournament_id);
      if (!t || t.guild_id !== interaction.guildId) return interaction.reply(hidden('❌ Tournament not found.'));
      if (match.status === 'approved' || match.status === 'bye') return interaction.reply(hidden('❌ This match is already finished.'));
      const { winner, matchTeams } = await findWinnerInMatch(t.id, match, winnerInput);
      if (!winner) return interaction.reply(hidden(`❌ Winner not found in match #${matchId}. Use exact display name or mention one player.\nMatch teams: ${matchTeams.map(tm => `**${tm.name}** (${tm.players.map(p => `<@${p}>`).join(' ')})`).join(' vs ')}`));
      await repo.updateMatch(matchId, { reported_winner_id: winner.id, status: 'reported' });
      await interaction.reply(`⏳ Reported winner for match #${matchId}: **${winner.name}**. Staff must approve.`);
      return postBracket(interaction, await repo.getTournamentById(t.id), `⏳ Winner reported for match #${matchId}.`);
    }

    if (cmd === 'approvewin') {
      const matchId = interaction.options.getInteger('match_id');
      const match = await repo.getMatch(matchId);
      const t = match ? await repo.getTournamentById(match.tournament_id) : null;
      if (!t || t.guild_id !== interaction.guildId) return interaction.reply(hidden('❌ Match not found.'));
      await assertStaff(interaction, t);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await approveMatch(interaction, t, matchId);
      return interaction.editReply(`✅ Approved match #${matchId}.`);
    }

    if (cmd === 'forcematchwin') {
      const matchId = interaction.options.getInteger('match_id');
      const winnerInput = interaction.options.getString('winner');
      const match = await repo.getMatch(matchId);
      const t = match ? await repo.getTournamentById(match.tournament_id) : null;
      if (!t || t.guild_id !== interaction.guildId) return interaction.reply(hidden('❌ Match not found.'));
      await assertStaff(interaction, t);
      const { winner, matchTeams } = await findWinnerInMatch(t.id, match, winnerInput);
      if (!winner) return interaction.reply(hidden(`❌ Winner not found in match #${matchId}. Teams: ${matchTeams.map(tm => tm.name).join(' vs ')}`));
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await repo.updateMatch(matchId, { reported_winner_id: winner.id, winner_team_id: winner.id, status: 'approved' });
      await archiveMatchChannel(interaction, t, match);
      await engine.createNextRoundIfReady(await repo.getTournamentById(t.id));
      const latest = await repo.getTournamentById(t.id);
      await syncTournamentChannels(interaction, latest, `force match ${matchId}`);
      await interaction.editReply(`✅ Force win set for match #${matchId}: **${winner.name}**.`);
      return postBracket(interaction, latest, `✅ Force win set for match #${matchId}.`);
    }

    if (cmd === 'unreg') {
      const targetUser = interaction.options.getUser('user');
      const tournamentId = interaction.options.getInteger('tournament_id');
      const t = tournamentId ? await repo.getTournamentById(tournamentId) : await getTournamentFromContext(interaction, false);
      if (!t || t.guild_id !== interaction.guildId) return interaction.reply(hidden('❌ No tournament found.'));
      const staff = await isStaff(interaction, t);
      const userId = targetUser?.id || interaction.user.id;
      if (targetUser && !staff) return interaction.reply(hidden('❌ Staff only to unregister another user.'));
      if (t.status !== 'registration' && !staff) return interaction.reply(hidden('❌ You can only unregister before the bracket starts. Ask staff if you need help.'));
      const teams = await repo.getTeams(t.id);
      const team = teams.find(tm => tm.players.includes(userId));
      if (!team) return interaction.reply(hidden('❌ No registered team found for that user.'));
      await repo.updateTeam(team.id, { active: 0 });
      await removeRegistrationRoleFromPlayers(interaction, t, team.players);
      await repo.log(interaction.guildId, t.id, 'TEAM_UNREGISTERED', `${team.name} removed by ${interaction.user.id}`);
      await interaction.reply(`✅ Unregistered **${team.name}** from **${t.name}**.`);
      return postBracket(interaction, t, `ℹ️ Team unregistered: **${team.name}**`);
    }

    if (cmd === 'teamlist') {
      const t = await getTournamentFromContext(interaction, false);
      if (!t) return interaction.reply(hidden('❌ No tournament found.'));
      const teams = await repo.getTeams(t.id);
      if (!teams.length) return interaction.reply(hidden('No teams registered yet.'));
      return interaction.reply(`**${t.name}** (#${t.id}) teams:\n` + teams.map((tm, i) => `${i + 1}. **${tm.name}** ${tm.checked_in ? '✅' : t.require_checkin ? '⏳' : '➖'} — ${tm.players.map(p => `<@${p}>`).join(' ')}`).join('\n').slice(0, 3800));
    }

    if (cmd === 'tournaments') {
      const tournaments = await repo.getActiveTournaments(interaction.guildId);
      if (!tournaments.length) return interaction.reply(hidden('No active tournaments.'));
      return interaction.reply(tournaments.map(t => `#${t.id} **${t.name}** — ${t.status} — signup <#${t.signup_channel_id}> — bracket <#${t.bracket_channel_id}> — check-in ${t.require_checkin ? 'required' : 'off'}`).join('\n').slice(0, 3900));
    }

    if (cmd === 'togglecheckin') {
      const id = interaction.options.getInteger('tournament_id');
      const required = interaction.options.getBoolean('required');
      const t = id ? await repo.getTournamentById(id) : await getTournamentFromContext(interaction, false);
      if (!t || t.guild_id !== interaction.guildId) return interaction.reply(hidden('❌ No tournament found.'));
      await assertStaff(interaction, t);
      await repo.updateTournament(t.id, { require_checkin: required ? 1 : 0 });
      if (!required) for (const team of await repo.getTeams(t.id)) await repo.updateTeam(team.id, { checked_in: 1 });
      const fresh = await repo.getTournamentById(t.id);
      await interaction.reply(`✅ Check-in requirement for **${fresh.name}** is now **${required ? 'ON' : 'OFF'}**.`);
      return postBracket(interaction, fresh, `ℹ️ Check-in requirement is now **${required ? 'ON' : 'OFF'}**.`);
    }

    if (cmd === 'dqteam') {
      const matchId = interaction.options.getInteger('match_id');
      const dqInput = interaction.options.getString('team');
      const match = await repo.getMatch(matchId);
      const t = match ? await repo.getTournamentById(match.tournament_id) : null;
      if (!t || t.guild_id !== interaction.guildId) return interaction.reply(hidden('❌ Match not found.'));
      await assertStaff(interaction, t);
      const dq = await findTeamInTournament(t.id, dqInput);
      if (!dq || ![match.team1_id, match.team2_id].includes(dq.id)) return interaction.reply(hidden('❌ Team is not in this match.'));
      const winnerId = match.team1_id === dq.id ? match.team2_id : match.team1_id;
      if (!winnerId) return interaction.reply(hidden('❌ Cannot award win because no opponent exists.'));
      await repo.updateMatch(matchId, { reported_winner_id: winnerId, winner_team_id: winnerId, status: 'approved' });
      await archiveMatchChannel(interaction, t, match);
      await engine.createNextRoundIfReady(await repo.getTournamentById(t.id));
      const latest = await repo.getTournamentById(t.id);
      await syncTournamentChannels(interaction, latest, `dq match ${matchId}`);
      await interaction.reply('✅ DQ recorded. Opponent advances.');
      return postBracket(interaction, latest, `✅ DQ recorded for match #${matchId}.`);
    }


    if (cmd === 'syncchannels') {
      const id = interaction.options.getInteger('tournament_id');
      const t = id ? await repo.getTournamentById(id) : await getTournamentFromContext(interaction, false);
      if (!t || t.guild_id !== interaction.guildId) return interaction.reply(hidden('❌ No tournament found.'));
      await assertStaff(interaction, t);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await syncTournamentChannels(interaction, t, 'manual sync');
      return interaction.editReply(`✅ Channel sync done. Created: **${result.create.created || 0}**. Cleaned: **${result.cleanup.cleaned || 0}**.${result.create.skipped ? `
Note: ${result.create.skipped}` : ''}`);
    }

    if (cmd === 'resetbracket') {
      const id = interaction.options.getInteger('tournament_id');
      const t = id ? await repo.getTournamentById(id) : await getTournamentFromContext(interaction);
      if (!t || t.guild_id !== interaction.guildId) return interaction.reply(hidden('❌ No tournament found.'));
      await assertStaff(interaction, t);
      await cleanupRegistrationRoles(interaction, t);
      await repo.resetTournament(interaction.guildId, t.id);
      return interaction.reply(hidden(`✅ Tournament **${t.name}** ended/reset.`));
    }
  } catch (err) {
    console.error(err);
    await safeInteractionError(interaction, `❌ Error: ${err.message}`);
    return;
  }
});

module.exports = client;
