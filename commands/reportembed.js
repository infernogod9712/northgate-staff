const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { mainSettings } = require('../handlers/settings');
const { canManageStaff } = require('../handlers/permissions');
const { reportBoxEmbed, reportBoxRow } = require('../handlers/embeds');

// /reportembed
// Posts the staff report panel. It goes in the main server's report channel set
// with /config, wherever this is run from. If no report channel is set, it goes in
// the channel you run the command in. The panel stays up forever, so this only
// needs running once.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('reportembed')
    .setDescription('Post the staff report panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!(await canManageStaff(interaction.member))) {
      return interaction.editReply({ content: 'You need the Staff Leadership role to use this.' });
    }

    const { staffReportChannel } = mainSettings(interaction.guild.id);
    const channel = staffReportChannel
      ? await interaction.client.channels.fetch(staffReportChannel).catch(() => null)
      : interaction.channel;

    if (!channel) {
      return interaction.editReply({ content: 'The report channel could not be found. Check report_channel with /config in the main server.' });
    }

    try {
      await channel.send({ embeds: [reportBoxEmbed()], components: [reportBoxRow()] });
    } catch (err) {
      return interaction.editReply({ content: `Could not post there: ${err.message}` });
    }

    await interaction.editReply({ content: `Report panel posted in <#${channel.id}>.` });
  },
};
