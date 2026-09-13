const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType, EmbedBuilder } = require('discord.js');
const {
  HUB_KEYS, MAIN_KEYS, BOTH_KEYS, getSettings, updateSettings, getServers, setServer, serverRoles,
} = require('../handlers/settings');
const { isOwner, isPubliclyReadable } = require('../handlers/permissions');
const { COLORS } = require('../handlers/embeds');

// /config [options]
// One command for every setting. Run it with no options to see what is set now.
// Owner only: the two ids in .env, nobody else, not even Administrators.
//
// The bot lives in two servers with different jobs, so the first thing to set in
// each one is what it is:
//
//   /config server:hub   in the NorthGate Studios staff hub
//   /config server:main  in the NGC main server
//
// After that, each server only accepts its own settings. A role or channel option
// can only ever pick things from the server you are standing in, so the hub's
// settings have to be set from inside the hub, and the main server's from inside
// the main server. Setting them in the wrong place is refused out loud instead of
// being saved somewhere nothing will ever read it.
//
// hr_panel_channel is the exception: both servers get their own HR panel, so it is
// accepted in either one, each server keeping its own.

// [option name, settings key, kind, label shown in the embed]
const OPTIONS = [
  ['staff_leadership', 'staffLeadershipRole', 'role',    'Staff Leadership Role'],
  ['promote_channel',  'promoteChannel',      'channel', 'Promotion Log'],
  ['infract_channel',  'infractChannel',      'channel', 'Infraction Log'],
  ['report_forum',     'staffReportForum',    'channel', 'Report Forum (HR)'],
  ['loa_channel',      'loaChannel',          'channel', 'Leave Forum'],
  ['report_channel',   'staffReportChannel',  'channel', 'Report Panel Channel'],
  ['hr_role',          'hrRole',              'role',    'HR Role'],
  ['log_channel',      'logChannel',          'channel', 'Command Log'],
  ['hr_panel_channel', 'hrPanelChannel',      'channel', 'HR Panel Channel'],
];

// Which server a setting belongs to: 'hub', 'main' or 'either'.
const owner = (key) => {
  if (HUB_KEYS.includes(key)) return 'hub';
  if (MAIN_KEYS.includes(key)) return 'main';
  if (BOTH_KEYS.includes(key)) return 'either';
  return null;
};
const fits = (key, roles) => (owner(key) === 'either' ? roles.length > 0 : roles.includes(owner(key)));

// Channels whose contents members must not be able to read. The HR panel names
// people with low performance ratings, so a channel @everyone can see is refused.
const PRIVATE_ONLY = ['hrPanelChannel'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Set up the bot for this server (bot owners only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) => o
      .setName('server')
      .setDescription('What this server is. Set this first in each server')
      .addChoices(
        { name: 'Staff hub (NorthGate Studios)', value: 'hub' },
        { name: 'Main server (NGC)', value: 'main' },
      ))
    .addRoleOption((o) => o
      .setName('staff_leadership')
      .setDescription('Staff hub: role allowed to use /promote and every HR command'))
    .addChannelOption((o) => o
      .setName('promote_channel')
      .setDescription('Staff hub: where promotions are logged')
      .addChannelTypes(ChannelType.GuildText))
    .addChannelOption((o) => o
      .setName('infract_channel')
      .setDescription('Staff hub: where infractions, suspensions and firings are logged')
      .addChannelTypes(ChannelType.GuildText))
    .addChannelOption((o) => o
      .setName('report_forum')
      .setDescription('Staff hub: the locked HR forum reports are filed in')
      .addChannelTypes(ChannelType.GuildForum))
    .addChannelOption((o) => o
      .setName('loa_channel')
      .setDescription('Staff hub: forum where each leave gets its own post')
      .addChannelTypes(ChannelType.GuildForum))
    .addChannelOption((o) => o
      .setName('report_channel')
      .setDescription('Main server: channel the staff report panel is posted in')
      .addChannelTypes(ChannelType.GuildText))
    .addRoleOption((o) => o
      .setName('hr_role')
      .setDescription('Main server: role allowed to use the HR commands'))
    .addChannelOption((o) => o
      .setName('log_channel')
      .setDescription('Main server: where every command used in either server is logged')
      .addChannelTypes(ChannelType.GuildText))
    .addChannelOption((o) => o
      .setName('hr_panel_channel')
      .setDescription('Either server: staff-only channel for the auto-updating HR panel')
      .addChannelTypes(ChannelType.GuildText)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!isOwner(interaction.user.id)) {
      return interaction.editReply({ content: 'Only the bot owners can change the configuration.' });
    }

    const guildId = interaction.guild.id;
    const lines = [];
    let problem = false;

    // Server role first, so the settings in this same command are checked against it.
    const serverChoice = interaction.options.getString('server');
    if (serverChoice) {
      const before = getServers()[serverChoice];
      setServer(serverChoice, guildId);
      const name = serverChoice === 'hub' ? 'staff hub' : 'main server';
      lines.push(before && before !== guildId
        ? `**This server is now the ${name}.** It replaces the server that was the ${name} before.`
        : `**This server is the ${name}.**`);
    }

    const roles = serverRoles(guildId);
    const current = getSettings(guildId);
    const patch = {};

    for (const [optionName, key, kind] of OPTIONS) {
      const value = kind === 'role'
        ? interaction.options.getRole(optionName)
        : interaction.options.getChannel(optionName);
      if (!value) continue;

      if (!fits(key, roles)) {
        problem = true;
        const needs = owner(key);
        const where = needs === 'hub' ? 'staff hub' : 'main server';
        lines.push(roles.length && needs !== 'either'
          ? `Skipped **${optionName}**: that belongs to the ${where}, and this server is not it.`
          : `Skipped **${optionName}**: set \`server\` first so I know whether this is the hub or the main server.`);
        continue;
      }

      if (PRIVATE_ONLY.includes(key) && isPubliclyReadable(value)) {
        problem = true;
        lines.push(`Skipped **${optionName}**: @everyone can read <#${value.id}>, and the HR panel shows staff performance ratings. Pick a staff-only channel.`);
        continue;
      }

      patch[key] = value.id;
      // A new panel channel means a new panel message. The old message, if there
      // was one, simply stops updating and can be deleted by hand.
      if (key === 'hrPanelChannel' && current.hrPanelChannel !== value.id) patch.hrPanelMessage = null;

      lines.push(kind === 'role' ? `**${optionName}** set to <@&${value.id}>` : `**${optionName}** set to <#${value.id}>`);
    }

    if (Object.keys(patch).length) updateSettings(guildId, patch);

    // Always show the whole picture, so one command both sets and checks.
    const s = getSettings(guildId);
    const servers = getServers();
    const show = (id, kind) => (!id ? 'not set' : kind === 'role' ? `<@&${id}>` : `<#${id}>`);
    const describe = (id) => (!id ? 'not set' : id === guildId ? 'this server' : 'set, in another server');

    const embed = new EmbedBuilder()
      .setColor(problem ? COLORS.infract : lines.length ? COLORS.promote : COLORS.info)
      .setTitle(`Configuration - ${interaction.guild.name}`)
      .setDescription(lines.length ? lines.join('\n') : 'Nothing changed. Here is the current setup.')
      .addFields(
        { name: 'Staff Hub', value: describe(servers.hub), inline: true },
        { name: 'Main Server', value: describe(servers.main), inline: true },
      );

    // Only list the settings this server actually owns, so nobody tries to fill in
    // a field that the command will then refuse.
    for (const [, key, kind, label] of OPTIONS) {
      if (fits(key, roles)) embed.addFields({ name: label, value: show(s[key], kind), inline: false });
    }

    embed
      .setFooter({ text: roles.length
        ? 'Hub settings are set in the hub, main server settings in the main server.'
        : 'Start with /config server:hub in the staff hub, or /config server:main in the main server.' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
