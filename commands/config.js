const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType, EmbedBuilder } = require('discord.js');
const { getSettings, updateSettings } = require('../handlers/settings');
const { isOwner } = require('../handlers/permissions');
const { COLORS } = require('../handlers/embeds');

// /config [options]
// One command for every setting. Run it with no options to see what is set now.
// Owner only: the two ids in .env, nobody else, not even Administrators.
//
// Settings live per guild, so you run this once in the main server (for the report
// panel channel) and once in the staff hub (for everything else).
module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Set up the bot for this server (bot owners only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption((o) => o
      .setName('staff_leadership')
      .setDescription('Role allowed to use /promote and /infract'))
    .addChannelOption((o) => o
      .setName('promote_channel')
      .setDescription('Where promotions are logged')
      .addChannelTypes(ChannelType.GuildText))
    .addChannelOption((o) => o
      .setName('infract_channel')
      .setDescription('Where infractions are logged')
      .addChannelTypes(ChannelType.GuildText))
    .addChannelOption((o) => o
      .setName('report_channel')
      .setDescription('Main server channel the staff report panel is posted in')
      .addChannelTypes(ChannelType.GuildText))
    .addChannelOption((o) => o
      .setName('report_forum')
      .setDescription('Locked HR forum in the staff hub where reports are filed')
      .addChannelTypes(ChannelType.GuildForum)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!isOwner(interaction.user.id)) {
      return interaction.editReply({ content: 'Only the bot owners can change the configuration.' });
    }

    // Each option maps to one settings key. Anything the user left out stays as it was.
    const OPTIONS = [
      ['staff_leadership', 'staffLeadershipRole', 'role'],
      ['promote_channel',  'promoteChannel',     'channel'],
      ['infract_channel',  'infractChannel',     'channel'],
      ['report_channel',   'staffReportChannel', 'channel'],
      ['report_forum',     'staffReportForum',   'channel'],
    ];

    const patch = {};
    const changed = [];
    for (const [optionName, key, kind] of OPTIONS) {
      const value = kind === 'role'
        ? interaction.options.getRole(optionName)
        : interaction.options.getChannel(optionName);
      if (!value) continue;
      patch[key] = value.id;
      changed.push(kind === 'role' ? `**${optionName}** set to <@&${value.id}>` : `**${optionName}** set to <#${value.id}>`);
    }

    if (changed.length) updateSettings(interaction.guild.id, patch);

    // Always show the full current setup, so one command both sets and checks.
    const s = getSettings(interaction.guild.id);
    const show = (id, kind) => {
      if (!id) return 'not set';
      return kind === 'role' ? `<@&${id}>` : `<#${id}>`;
    };

    const embed = new EmbedBuilder()
      .setColor(changed.length ? COLORS.promote : COLORS.info)
      .setTitle(`Configuration - ${interaction.guild.name}`)
      .setDescription(changed.length ? changed.join('\n') : 'Nothing changed. Here is the current setup.')
      .addFields(
        { name: 'Staff Leadership Role', value: show(s.staffLeadershipRole, 'role'), inline: false },
        { name: 'Promotion Log',         value: show(s.promoteChannel, 'channel'),   inline: true },
        { name: 'Infraction Log',        value: show(s.infractChannel, 'channel'),   inline: true },
        { name: 'Report Panel Channel',  value: show(s.staffReportChannel, 'channel'), inline: false },
        { name: 'Report Forum (HR)',     value: show(s.staffReportForum, 'channel'),  inline: false },
      )
      .setFooter({ text: 'Settings are per server. Run /config in the main server and the staff hub separately.' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
